# height_punch — planned

Not built yet. Will be the punch-frame counterpart to
[`../height_guard/`](../height_guard/): the same click (chin tip + top of
the lead shoulder), but sampled from frames that fall *inside* a punch
instead of the 0.5–5s non-punch band `height_guard`/`chin_sampler_v3.py`
restrict to. `height_guard`'s README explains why guard-only sampling
exists in the first place — the shoulder roll mid-punch moves "top of the
deltoid" enough that it needs its own sampling pass and its own labeling
run, not a shared queue with the guard frames.
