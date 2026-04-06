# app/routers/speech.py
#
# Full pipeline:
#   Audio
#     → Step 1: ASR + LangID  (openai/whisper-large-v3 — detects language automatically)
#     → Step 2: [optional MT] → Google Translate → Target
#     → Step 3: [optional TTS] → gender detect → edge-tts neural voice

import os
import asyncio
import tempfile
import subprocess
import numpy as np
import scipy.io.wavfile as wav
import torch
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import time
from session_helper import save_session

router   = APIRouter()
executor = ThreadPoolExecutor(max_workers=2)

# ── config ───────────────────────────────────────────────────────────────────
WHISPER_MODEL_ID = "openai/whisper-large-v3"
SAMPLE_RATE      = 16000

# Languages whisper reports → our internal key
WHISPER_LANG_TO_KEY = {
    "tamil":     "tamil",
    "telugu":    "telugu",
    "hindi":     "hindi",
    "malayalam": "malayalam",
    "kannada":   "kannada",
    "english":   "english",
}

SUPPORTED_LANGS = set(WHISPER_LANG_TO_KEY.keys())

GOOGLE_LANG_CODES = {
    "hindi":     "hi",
    "tamil":     "ta",
    "kannada":   "kn",
    "telugu":    "te",
    "malayalam": "ml",
    "english":   "en",
}

TARGET_LANG_MAP = {
    "Hindi":     "hindi",
    "Tamil":     "tamil",
    "Kannada":   "kannada",
    "Telugu":    "telugu",
    "Malayalam": "malayalam",
    "English":   "english",
}

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"[speech] Device: {device}")

# ── model cache ───────────────────────────────────────────────────────────────
_pipe = None   # HuggingFace ASR pipeline (whisper-large-v3)


# ── model loader (lazy, called once) ─────────────────────────────────────────
def _load_model():
    global _pipe
    if _pipe is not None:
        return

    from transformers import pipeline, AutoModelForSpeechSeq2Seq, AutoProcessor

    print(f"[speech] Loading {WHISPER_MODEL_ID}...")

    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        WHISPER_MODEL_ID,
        torch_dtype=torch.float16 if device.type == "cuda" else torch.float32,
        low_cpu_mem_usage=True,
    )
    model.to(device)

    processor = AutoProcessor.from_pretrained(WHISPER_MODEL_ID)

    _pipe = pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        torch_dtype=torch.float16 if device.type == "cuda" else torch.float32,
        device=device,
        return_timestamps=False,
    )

    print(f"[speech] {WHISPER_MODEL_ID} ready ✓")


# ── audio helper ──────────────────────────────────────────────────────────────
def load_audio_16k(audio_path: str) -> np.ndarray:
    """Convert any audio to 16kHz mono WAV using ffmpeg, return float32 array."""
    wav_path = audio_path + "_16k.wav"
    subprocess.run([
        "ffmpeg", "-y", "-i", audio_path,
        "-ar", "16000", "-ac", "1", "-f", "wav", wav_path,
    ], capture_output=True)

    sample_rate, data = wav.read(wav_path)

    if os.path.exists(wav_path):
        os.unlink(wav_path)

    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float32) / 2147483648.0
    else:
        data = data.astype(np.float32)

    return data


# language token IDs (ISO 639-1 format — confirmed working with whisper-large-v3)
LANG_TOKEN_IDS = {
    50287: "tamil",
    50299: "telugu",
    50276: "hindi",
    50296: "malayalam",
    50306: "kannada",
    50259: "english",
    50320: "marathi",
    50302: "bengali",
    50321: "punjabi",
    50333: "gujarati",
    50290: "urdu",
}


# ── step 1: ASR + language identification ─────────────────────────────────────
def transcribe_and_detect(audio_path: str) -> dict:
    """
    Two cheap calls:
      1. Encoder + one decoder step → language token logits  (no generate)
      2. model.generate() → transcript
    """
    _load_model()

    audio = load_audio_16k(audio_path)
    audio = audio / (np.abs(audio).max() + 1e-8)

    model     = _pipe.model
    tokenizer = _pipe.tokenizer

    input_features = _pipe.feature_extractor(
        audio, sampling_rate=SAMPLE_RATE, return_tensors="pt"
    ).input_features.to(device)

    if device.type == "cuda":
        input_features = input_features.half()

    # ── language detection via encoder logits (single decoder step) ──
    with torch.no_grad():
        decoder_input = torch.tensor(
            [[model.config.decoder_start_token_id]],
            device=device, dtype=torch.long
        )
        logits = model(
            input_features    = input_features,
            decoder_input_ids = decoder_input,
        ).logits  # (1, 1, vocab_size)

    probs            = torch.softmax(logits[0, 0].float(), dim=-1)
    best_token_id    = max(LANG_TOKEN_IDS, key=lambda tid: probs[tid].item())
    detected_lang    = LANG_TOKEN_IDS[best_token_id]
    lang_confidence  = probs[best_token_id].item()

    # ── transcription ──
    with torch.no_grad():
        generated = model.generate(
            input_features,
            task             = "transcribe",
            language         = None,
            forced_decoder_ids = None,
            max_new_tokens   = 256,
        )

    transcript = tokenizer.decode(generated[0], skip_special_tokens=True).strip()

    lang_key  = WHISPER_LANG_TO_KEY.get(detected_lang, "unknown")
    lang_code = GOOGLE_LANG_CODES.get(lang_key)

    print(f"[speech] Detected: {detected_lang} (conf={lang_confidence:.3f}) → key={lang_key}")
    print(f"[speech] Transcript: {transcript[:80]}...")

    return {
        "transcript":      transcript,
        "language":        lang_key,
        "lang_code":       lang_code,
        "lang_confidence": round(lang_confidence, 3),
    }


# ── step 2: translation via Google Translate ──────────────────────────────────
def translate(text: str, src_lang: str, tgt_lang_key: str) -> dict:
    if tgt_lang_key == src_lang or src_lang == "unknown":
        return {"translation": text, "source": "no_translation_needed"}

    try:
        from deep_translator import GoogleTranslator

        src_code = GOOGLE_LANG_CODES.get(src_lang, "auto")
        tgt_code = GOOGLE_LANG_CODES.get(tgt_lang_key, "en")

        result = GoogleTranslator(source=src_code, target=tgt_code).translate(text)
        print(f"[speech] Google Translate ({src_lang} → {tgt_lang_key}): {result[:60]}...")
        return {"translation": result, "source": "google_translate"}

    except Exception as e:
        print(f"[speech] Google Translate failed: {e}")
        return {"translation": text, "source": "translation_failed"}


# ── step 3: TTS (edge-tts + gender detection) ─────────────────────────────────
VOICE_DB = {
    "hindi":     {"male": "hi-IN-MadhurNeural",   "female": "hi-IN-SwaraNeural"},
    "malayalam": {"male": "ml-IN-MidhunNeural",   "female": "ml-IN-SobhanaNeural"},
    "telugu":    {"male": "te-IN-ManoharNeural",  "female": "te-IN-ShrutiNeural"},
    "tamil":     {"male": "ta-IN-ValluvarNeural", "female": "ta-IN-PallaviNeural"},
    "kannada":   {"male": "kn-IN-GaganNeural",    "female": "kn-IN-SapnaNeural"},
    "english":   {"male": "en-US-GuyNeural",      "female": "en-US-JennyNeural"},
}

_speaker_classifier = None


def get_speaker_classifier():
    global _speaker_classifier
    if _speaker_classifier is None:
        from speechbrain.pretrained import EncoderClassifier
        print("[speech] Loading speaker gender classifier...")
        _speaker_classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="tmp_model",
        )
        print("[speech] Speaker classifier loaded ✓")
    return _speaker_classifier


def detect_gender(audio_path: str) -> str:
    try:
        clf        = get_speaker_classifier()
        signal     = clf.load_audio(audio_path)
        embeddings = clf.encode_batch(signal)
        val        = torch.mean(embeddings).item()
        gender     = "female" if val > 0 else "male"
        print(f"[speech] Gender: {gender} (val={val:.4f})")
        return gender
    except Exception as e:
        print(f"[speech] Gender detection failed: {e} → defaulting to female")
        return "female"


async def run_tts(text: str, lang_key: str, audio_path: str) -> str:
    import edge_tts
    gender         = detect_gender(audio_path)
    voices         = VOICE_DB.get(lang_key, VOICE_DB["hindi"])
    selected_voice = voices[gender]
    output_path    = audio_path + "_tts_output.mp3"
    communicate    = edge_tts.Communicate(text, selected_voice)
    await communicate.save(output_path)
    print(f"[speech] TTS done → {selected_voice}")
    return output_path


# ── full pipeline ─────────────────────────────────────────────────────────────
def run_pipeline(audio_path: str, target_lang: str, enable_mt: bool = True) -> dict:
    tgt_lang_key = TARGET_LANG_MAP.get(target_lang, "hindi").lower()

    # Steps 1 — ASR + language detection (single Whisper call)
    asr_result = transcribe_and_detect(audio_path)
    transcript      = asr_result["transcript"]
    language        = asr_result["language"]
    lang_code       = asr_result["lang_code"]
    lang_confidence = asr_result["lang_confidence"]

    if not transcript:
        raise ValueError("Could not transcribe audio")

    # Step 2 — Translation (only if enable_mt=True AND source != target)
    same_language = (language == tgt_lang_key) or (language == "unknown")

    if not enable_mt:
        print("[speech] MT disabled by user → skipping translation")
        translation  = ""
        trans_source = "mt_disabled"
    elif same_language:
        print(f"[speech] Source == Target ({language}) → skipping translation")
        translation  = transcript
        trans_source = "no_translation_needed"
    else:
        print(f"[speech] Translating {language} → {tgt_lang_key}...")
        trans_result = translate(transcript, language, tgt_lang_key)
        translation  = trans_result["translation"]
        trans_source = trans_result["source"]

    print(f"[speech] Done. lang={language} trans_source={trans_source}")

    return {
        "transcript":         transcript,
        "text":               transcript,
        "translation":        translation,
        "detected_lang":      language,
        "lang_confidence":    lang_confidence,
        "asr_model":          WHISPER_MODEL_ID,
        "translation_source": trans_source,
        "same_language":      same_language,
        "target_lang":        target_lang,
        "confidence":         lang_confidence,
    }


# ── endpoint ──────────────────────────────────────────────────────────────────
@router.post("/api/speech/translate")
async def speech_translate(
    audio:       UploadFile = File(...),
    target_lang: str        = Form("Hindi"),
    enable_mt:   str        = Form("true"),   # "true" | "false" — MT toggle
    enable_tts:  str        = Form("false"),  # "true" | "false" — TTS toggle
):
    start    = time.time()
    do_mt    = enable_mt.lower()  == "true"
    do_tts   = enable_tts.lower() == "true"
    tts_path = None

    ext = os.path.splitext(audio.filename)[-1].lower() or ".webm"

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(await audio.read())
        audio_path = tmp.name

    try:
        # Steps 1–2 — ASR + optional MT (runs in thread pool)
        loop   = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            executor,
            lambda: run_pipeline(audio_path, target_lang, enable_mt=do_mt),
        )

        # Step 3 — TTS (optional, async)
        if do_tts:
            tgt_lang_key = TARGET_LANG_MAP.get(target_lang, "hindi").lower()
            tts_text     = result.get("translation") or result.get("transcript", "")

            if tts_text:
                try:
                    tts_path = await run_tts(tts_text, tgt_lang_key, audio_path)
                    import base64
                    with open(tts_path, "rb") as f:
                        tts_b64 = base64.b64encode(f.read()).decode("utf-8")
                    result["tts_audio"] = f"data:audio/mp3;base64,{tts_b64}"
                    print("[speech] TTS audio embedded in response ✓")
                except Exception as e:
                    print(f"[speech] TTS failed: {e}")
                    result["tts_audio"] = None
            else:
                result["tts_audio"] = None
        else:
            result["tts_audio"] = None

        result["mt_enabled"]  = do_mt
        result["tts_enabled"] = do_tts

        await save_session(
            mode        = "speech",
            transcript  = result.get("transcript"),
            translation = result.get("translation"),
            target_lang = target_lang,
            confidence  = result.get("confidence"),
            status      = "done",
            start_time  = start,
        )

        return result

    except HTTPException:
        save_session(mode="speech", status="error", start_time=start)
        raise
    except Exception as e:
        save_session(mode="speech", status="error", start_time=start)
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
        if tts_path and os.path.exists(tts_path):
            os.unlink(tts_path)