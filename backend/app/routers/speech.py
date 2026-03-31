# app/routers/speech.py
#
# Full pipeline:
#   Audio
#     → Step 1: LangID  (BetterLangIDClassifier — same as inference.py)
#     → Step 2: ASR     (your whisper-{lang}-lora  OR  whisper-small fallback)
#     → Step 3: → English  (Wizard1203/nllb-{lang}-en)
#     → Step 4: → Target   (Wizard1203/nllb-en-{lang}  OR  Google Translate fallback)

import os
import asyncio
import tempfile
import subprocess
import numpy as np
import scipy.io.wavfile as wav
import torch
import torch.nn as nn
import torchaudio.transforms as T
from huggingface_hub import hf_hub_download
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
import time
from session_helper import save_session

router   = APIRouter()
executor = ThreadPoolExecutor(max_workers=2)

# ── config ──────────────────────────────────────────────────────────────────
HF_USERNAME                 = "samruddhi1916"
LANGID_CONFIDENCE_THRESHOLD = 0.5    # same as inference.py
WHISPER_BASE_ID             = "openai/whisper-small"

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# index → language name (same as inference.py)
IDX_TO_LANG = {
    0: "tamil",
    1: "telugu",
    2: "hindi",
    3: "malayalam",
    4: "kannada",
}

# Your Whisper LoRA ASR models
YOUR_ASR_MODELS = {
    "kannada":   "Samruddhi1916/whisper-kannada-lora",
    "tamil":     "Samruddhi1916/whisper-tamil-lora",
    "malayalam": "Samruddhi1916/whisper-malayalam-lora",
    "hindi":     "Samruddhi1916/whisper-hindi-lora",
    "telugu":    "Samruddhi1916/whisper-telugu-lora",
}

# Your NLLB translation models
# lang → English
YOUR_TO_EN_MODELS = {
    "malayalam": "Wizard1203/nllb-ml-en",
    "tamil":     "Wizard1203/nllb-ta-en",
    "kannada":   "Wizard1203/nllb-kn-en",
    "telugu":    "Wizard1203/nllb-te-en",
    "hindi":     "Wizard1203/nllb-hi-en",
}
# English → lang
YOUR_FROM_EN_MODELS = {
    "malayalam": "Wizard1203/nllb-en-ml",
    "tamil":     "Wizard1203/nllb-en-ta",
    "kannada":   "Wizard1203/nllb-en-kn",
    "telugu":    "Wizard1203/nllb-en-te",
    "hindi":     "Wizard1203/nllb-en-hi",
}

# NLLB language codes for tokenizer forced_bos_token
NLLB_LANG_CODES = {
    "malayalam": "mal_Mlym",
    "tamil":     "tam_Taml",
    "kannada":   "kan_Knda",
    "telugu":    "tel_Telu",
    "hindi":     "hin_Deva",
    "english":   "eng_Latn",
}

# Target language name → NLLB key mapping
TARGET_LANG_MAP = {
    "Hindi":     "hindi",
    "Tamil":     "tamil",
    "Kannada":   "kannada",
    "Telugu":    "telugu",
    "Malayalam": "malayalam",
    "English":   "english",
}


# ── LangID model (same as inference.py) ──────────────────────────────────────
class BetterFeatureExtractor(nn.Module):
    def __init__(self, n_mfcc=40):
        super().__init__()
        self.mfcc = T.MFCC(
            sample_rate=16000, n_mfcc=n_mfcc,
            melkwargs={"n_fft": 400, "hop_length": 160, "n_mels": 64}
        )
    def forward(self, waveform):
        mfcc   = self.mfcc(waveform)
        delta  = mfcc[:, :, 1:] - mfcc[:, :, :-1]
        delta2 = delta[:, :, 1:] - delta[:, :, :-1]
        def stats(x):
            return torch.cat([x.mean(dim=-1), x.std(dim=-1)], dim=-1)
        return torch.cat([stats(mfcc), stats(delta), stats(delta2)], dim=-1)


class BetterLangIDClassifier(nn.Module):
    def __init__(self, num_langs=5):
        super().__init__()
        self.features   = BetterFeatureExtractor()
        self.classifier = nn.Sequential(
            nn.Linear(240, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Dropout(0.4),
            nn.Linear(512, 256), nn.BatchNorm1d(256), nn.ReLU(), nn.Dropout(0.4),
            nn.Linear(256, 128), nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(128, num_langs)
        )
    def forward(self, waveform):
        return self.classifier(self.features(waveform))


# ── model cache ───────────────────────────────────────────────────────────────
_langid_model  = None
_asr_cache     = {}    # { "hindi": (processor, model) }
_asr_fallback  = None
_nllb_cache    = {}    # { "Wizard1203/nllb-ml-en": (tokenizer, model) }


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


# ── step 1: language identification (same model as inference.py) ──────────────
def get_langid_model():
    global _langid_model
    if _langid_model is None:
        print("[speech] Loading LangID (custom MFCC model)...")
        path  = hf_hub_download(repo_id=f"{HF_USERNAME}/langid-indic", filename="langid_best.pt")
        model = BetterLangIDClassifier().to(device)
        model.load_state_dict(torch.load(path, map_location=device))
        model.eval()
        _langid_model = model
        print("[speech] LangID loaded ✓")
    return _langid_model


def identify_language(audio_path: str) -> dict:
    try:
        model    = get_langid_model()
        audio    = load_audio_16k(audio_path)
        waveform = torch.tensor(audio).unsqueeze(0).to(device)

        # pad/trim to 8 seconds — same as inference.py
        max_len = 16000 * 8
        if waveform.shape[1] > max_len:
            waveform = waveform[:, :max_len]
        else:
            waveform = torch.nn.functional.pad(waveform, (0, max_len - waveform.shape[1]))

        with torch.no_grad():
            probs      = torch.softmax(model(waveform), dim=1)[0]
            lang_idx   = probs.argmax().item()
            confidence = probs[lang_idx].item()

        lang = IDX_TO_LANG[lang_idx]
        print(f"[speech] LangID → {lang} ({confidence:.2f})")
        return {"language": lang, "confidence": confidence}

    except Exception as e:
        print(f"[speech] LangID failed: {e}")
        return {"language": "unknown", "confidence": 0.0}


# ── step 2: ASR ───────────────────────────────────────────────────────────────
def get_asr_model(lang_key: str):
    global _asr_cache
    if lang_key not in _asr_cache:
        from transformers import WhisperProcessor, WhisperForConditionalGeneration
        from peft import PeftModel
        model_id  = YOUR_ASR_MODELS[lang_key]
        print(f"[speech] Loading ASR LoRA: {model_id}")
        processor = WhisperProcessor.from_pretrained(WHISPER_BASE_ID)
        base      = WhisperForConditionalGeneration.from_pretrained(WHISPER_BASE_ID)
        model     = PeftModel.from_pretrained(base, model_id)
        model.eval()
        _asr_cache[lang_key] = (processor, model)
        print(f"[speech] ASR LoRA loaded for {lang_key} ✓")
    return _asr_cache[lang_key]


def get_asr_fallback():
    global _asr_fallback
    if _asr_fallback is None:
        from transformers import WhisperProcessor, WhisperForConditionalGeneration
        print("[speech] Loading ASR fallback (whisper-small)...")
        processor = WhisperProcessor.from_pretrained(WHISPER_BASE_ID)
        model     = WhisperForConditionalGeneration.from_pretrained(WHISPER_BASE_ID)
        model.eval()
        _asr_fallback = (processor, model)
        print("[speech] ASR fallback loaded ✓")
    return _asr_fallback


def transcribe(audio_path: str, language: str, use_lora: bool) -> str:
    audio = load_audio_16k(audio_path)

    if use_lora and language in YOUR_ASR_MODELS:
        try:
            processor, model = get_asr_model(language)
            source = f"your LoRA ({language})"
        except Exception as e:
            print(f"[speech] LoRA load failed: {e} → fallback")
            processor, model = get_asr_fallback()
            source = "whisper fallback (lora error)"
    else:
        processor, model = get_asr_fallback()
        source = "whisper fallback"

    inputs     = processor(audio, sampling_rate=16000, return_tensors="pt")
    gen_kwargs = {"max_new_tokens": 256, "task": "transcribe"}
    if language and language != "unknown":
        gen_kwargs["language"] = language

    with torch.no_grad():
        ids = model.generate(input_features=inputs["input_features"], **gen_kwargs)

    transcript = processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
    print(f"[speech] Transcribed ({source}): {transcript[:60]}...")
    return transcript


# ── step 3 & 4: translation ───────────────────────────────────────────────────
def get_nllb_model(model_id: str):
    global _nllb_cache
    if model_id not in _nllb_cache:
        import logging
        from transformers import NllbTokenizer, AutoModelForSeq2SeqLM
        logging.getLogger("transformers.modeling_utils").setLevel(logging.ERROR)
        print(f"[speech] Loading NLLB: {model_id}")
        tokenizer = NllbTokenizer.from_pretrained(model_id)
        model     = AutoModelForSeq2SeqLM.from_pretrained(model_id, torch_dtype=torch.float32)
        shared = model.model.shared.weight.data.clone()
        model.lm_head.weight.data                    = shared
        model.model.encoder.embed_tokens.weight.data = shared
        model.model.decoder.embed_tokens.weight.data = shared
        model.config.tie_word_embeddings = True
        model.eval()
        _nllb_cache[model_id] = (tokenizer, model)
        print(f"[speech] NLLB loaded: {model_id} ✓")
    return _nllb_cache[model_id]


def translate_nllb(text: str, model_id: str, tgt_lang_code: str) -> str:
    tokenizer, model = get_nllb_model(model_id)
    inputs     = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)
    forced_bos = tokenizer.convert_tokens_to_ids(tgt_lang_code)

    with torch.no_grad():
        ids = model.generate(
            **inputs,
            forced_bos_token_id=forced_bos,
            max_new_tokens=256,
            num_beams=4,
        )
    return tokenizer.batch_decode(ids, skip_special_tokens=True)[0].strip()


def translate_google(text: str, target_lang: str) -> str:
    """Fallback: Google Translate via deep-translator."""
    try:
        from deep_translator import GoogleTranslator
        lang_map = {
            "hindi": "hi", "tamil": "ta", "kannada": "kn",
            "telugu": "te", "malayalam": "ml", "english": "en",
        }
        code   = lang_map.get(target_lang.lower(), "en")
        result = GoogleTranslator(source="auto", target=code).translate(text)
        print(f"[speech] Google Translate → {result[:60]}...")
        return result
    except Exception as e:
        print(f"[speech] Google Translate failed: {e}")
        return text


def translate(text: str, src_lang: str, tgt_lang_key: str) -> dict:
    """
    Translate text from src_lang to tgt_lang.
    1. Try your NLLB model (src → English → target)
    2. If no NLLB model or it fails → Google Translate fallback
    Returns { translation, source }
    """
    # Step 3 — src → English (skip if already English)
    if src_lang == "english" or src_lang == "unknown":
        english_text = text
    elif src_lang in YOUR_TO_EN_MODELS:
        try:
            model_id     = YOUR_TO_EN_MODELS[src_lang]
            english_text = translate_nllb(text, model_id, "eng_Latn")
            print(f"[speech] → English (NLLB): {english_text[:60]}...")
        except Exception as e:
            print(f"[speech] NLLB src→en failed: {e} → Google")
            english_text = translate_google(text, "english")
    else:
        english_text = translate_google(text, "english")

    # Step 4 — English → target
    if tgt_lang_key == "english":
        return {"translation": english_text, "source": "nllb_or_google"}

    if tgt_lang_key in YOUR_FROM_EN_MODELS:
        try:
            model_id   = YOUR_FROM_EN_MODELS[tgt_lang_key]
            tgt_code   = NLLB_LANG_CODES[tgt_lang_key]
            final_text = translate_nllb(english_text, model_id, tgt_code)
            print(f"[speech] → {tgt_lang_key} (NLLB): {final_text[:60]}...")
            return {"translation": final_text, "source": "your_nllb"}
        except Exception as e:
            print(f"[speech] NLLB en→tgt failed: {e} → Google fallback")

    # Google fallback
    final_text = translate_google(english_text, tgt_lang_key)
    return {"translation": final_text, "source": "google_fallback"}


# ── full pipeline ─────────────────────────────────────────────────────────────
def run_pipeline(audio_path: str, target_lang: str) -> dict:
    try:
        tgt_lang_key = TARGET_LANG_MAP.get(target_lang, "hindi").lower()

        # Step 1 — language identification
        lang_result = identify_language(audio_path)
        language    = lang_result["language"]
        lang_conf   = lang_result["confidence"]

        # Step 2 — ASR
        use_lora   = lang_conf >= LANGID_CONFIDENCE_THRESHOLD and language in YOUR_ASR_MODELS
        transcript = transcribe(audio_path, language, use_lora)

        if not transcript:
            raise ValueError("Could not transcribe audio")

        # Step 3 & 4 — Translation only if source != target language
        same_language = (language == tgt_lang_key) or (language == "unknown")

        if same_language:
            print(f"[speech] Source == Target ({language}) → skipping translation")
            translation  = transcript
            trans_source = "no_translation_needed"
        else:
            print(f"[speech] Translating {language} → {tgt_lang_key}...")
            trans_result = translate(transcript, language, tgt_lang_key)
            translation  = trans_result["translation"]
            trans_source = trans_result["source"]

        print(f"[speech] Done. lang={language} conf={lang_conf:.2f} trans_source={trans_source}")

        return {
            "transcript":         transcript,
            "text":               transcript,
            "translation":        translation,
            "detected_lang":      language,
            "lang_confidence":    round(lang_conf, 3),
            "asr_model":          "your_lora" if use_lora else "whisper_fallback",
            "translation_source": trans_source,
            "same_language":      same_language,
            "target_lang":        target_lang,
            "confidence":         round(lang_conf, 3),
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise


# ── endpoint ──────────────────────────────────────────────────────────────────
@router.post("/api/speech/translate")
async def speech_translate(
    audio:            UploadFile     = File(...),
    target_lang:      str            = Form("Hindi"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    start = time.time()

    ext = os.path.splitext(audio.filename)[-1].lower() or ".webm"

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(await audio.read())
        audio_path = tmp.name

    try:
        result = await asyncio.get_running_loop().run_in_executor(
            executor,
            run_pipeline,
            audio_path,
            target_lang,
        )

        background_tasks.add_task(
            save_session,
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
        background_tasks.add_task(
            save_session,
            mode       = "speech",
            status     = "error",
            start_time = start,
        )
        raise
    except Exception as e:
        background_tasks.add_task(
            save_session,
            mode       = "speech",
            status     = "error",
            start_time = start,
        )
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)