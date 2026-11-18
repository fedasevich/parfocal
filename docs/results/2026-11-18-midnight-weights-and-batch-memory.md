# Result: Midnight weights size and peak memory for one batch on the Mac

- Date: 2026-11-18
- Backlog: AITUM-014 (a foundation model probe for the tumor map)
- Kind: benchmark
- Commit: 38c854ad
- Environment: Apple M4, 24 GB RAM, macOS 15.8.1, MPS GPU, torch 2.15.0, transformers 5.23.0, Python 3.14, two other agents running
- Data: synthetic random 224 px RGB patches, no slide pixels, no PHI

## Question

Decision 151 (the foundation model for the tumor probe) chose Midnight from kaiko.ai and asked for the weights size and RAM check first. This run answers how large the weights are on disk and how much memory one small embedding batch takes on the Mac, before any training or scoring.

## Method

1. `uvx --from huggingface_hub hf download kaiko-ai/midnight --revision adc6b15679c981cce6f9b018bbad09d16eeeda9f` into the default Hugging Face cache `~/.cache/huggingface/hub`, outside the repository. No token was needed.
2. `stat -L -f %z` on the cached `model.safetensors`.
3. A scratch script loaded the model with `parfocal_ml.midnight.midnight_model("mps")` in float32, then ran `MidnightEmbedder.embed` three times on one batch of 4 random patches, with `HF_HUB_OFFLINE=1`.
4. The Python process ran under `/usr/bin/time -l` (`uv run --package parfocal-ml --extra probe /usr/bin/time -l python ...`), and the script printed `torch.mps.driver_allocated_memory()` and `torch.mps.current_allocated_memory()` after the runs.

Preprocessing follows the model card: 224 px patches, mean and std 0.5 per channel. The embedding is the class token joined with the mean of the 256 patch tokens from `last_hidden_state`, 3,072 values a patch.

## Results

| Measure | Value |
| --- | --- |
| `model.safetensors` on disk | 4,546,005,432 bytes (4.55 GB), same as the Hub listing |
| Other files | `config.json` 879 bytes, `README.md` 8,080 bytes |
| Model load to MPS | 5.7 s (12.5 s on the first, cold run) |
| Batch of 4, runs 1 to 3 | 1.42 s, 1.10 s, 1.16 s |
| Token output | (4, 257, 1536) float32 |
| Features | (4, 3072) float32, all finite |
| Peak memory footprint of the process | 5,922,194,656 bytes (5.92 GB) |
| Maximum resident set size | 590,692,352 bytes (0.59 GB) |
| MPS driver allocated | 5,482,692,608 bytes (5.48 GB) |
| MPS current allocated | 4,546,213,888 bytes (4.55 GB) |
| System memory free before and after | 73% and 67% |

## Interpretation

The weights live almost entirely in MPS memory, which is why the resident set size stays near 0.6 GB while the peak footprint is about 5.9 GB. On a 24 GB Mac a batch of 4 in float32 leaves plenty of room, and larger batches mostly add activations. The timing is with two other agents running and is only a rough guide, about 0.3 s a patch.

## Follow-ups

- TODO: fit the linear probe on CAMELYON16 training patches (decision 136, a linear probe on frozen features counts as allowed training, option A) and record the training patch count and time.
- TODO: score the MLEVAL-005 (the tumor map evaluation) test slides with the probe and compare FROC and per-slide numbers against the MONAI ResNet18 on the same slides, which is the task's "Done when".
- TODO: the probe reads at 0.5 µm a pixel. The model card names no spacing, so that stays an open choice to check against a second spacing.
