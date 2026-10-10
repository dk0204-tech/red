# CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL

**Category:** Binary Exploitation / Reverse Engineering  
**Difficulty:** Hard  
**Points:** 600

> **PRALAYA // RED-ZONE-04**
>
> The old gatekeeper did not keep the final fragment in one place. The live
> process now demands a witness, then hides the continuation route behind a
> second integrity check.

## Objective

Connect to the service, recover the final archive fragment, and submit `RZ{...}`.

## Connection

```text
nc HOST 31337
```

## Player files

- `gatekeeper` — supplied ELF
- `server.py` — TCP wrapper
- `docker-compose.yml` — deployment

## Rules

The challenge is self-contained. No host, Docker daemon, or other-team access is required. Brute force is unnecessary.

## Recommended tools

`file`, `checksec`, `strings`, `readelf`, `objdump`, `gdb`, Python, and optionally pwntools.

## Hints

**Hint 1 — 75 pts**
> The first prompt is not just an identity field. Ask whether your bytes are being parsed as a format string.

**Hint 2 — 125 pts**
> The attestation fragment is the output of ordinary instructions in the binary. Reproduce that calculation; do not guess the witness.

**Hint 3 — 175 pts**
> There are two disclosure surfaces, not one. After the witness step, the continuity note is worth another careful `%p` probe.

**Hint 4 — 225 pts**
> The useful continuation value is not printed in plain form. It is combined with session state before being left on the stack.

**Hint 5 — 275 pts**
> The memo cursor moves. Derive its position, preserve the live canary, and remember that the first two qwords at the cursor are part of the integrity check.
