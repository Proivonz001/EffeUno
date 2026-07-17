"""Registra lo stream livetiming di una sessione F1 in corso.

Uso (dalla radice del repo, con il venv):
    .venv/Scripts/python.exe scripts/record_live.py --label spa_fp1

Da lanciare ~5 minuti PRIMA dell'inizio della sessione; si chiude da solo
dopo `--timeout` secondi senza messaggi (fine sessione). Il file prodotto
in live_streams/ e' l'ingrediente del replayer per sviluppare il live
offline (vedi docs/LIVE-PLAN.md).

AUTENTICAZIONE: dal 2025 il feed live richiede un abbonamento F1TV
(Access basta). Alla prima esecuzione fastf1 apre il login F1 nel
browser e poi salva il token in cache: fallo PRIMA del weekend, con
calma. Con --no-auth si prova senza token (potrebbe non ricevere nulla).

Nota: fuori sessione il feed e' muto — lo script si connette, non riceve
nulla e si chiude al timeout. Non e' un errore.
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "live_streams"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", default="session",
                        help="etichetta nel nome file (es. spa_race)")
    parser.add_argument("--timeout", type=int, default=120,
                        help="secondi di silenzio prima di chiudere (default 120)")
    parser.add_argument("--out", default=None,
                        help="percorso file esplicito (ignora --label)")
    parser.add_argument("--no-auth", action="store_true",
                        help="prova senza token F1TV")
    args = parser.parse_args()

    # se il token della libreria e' stato azzerato (bug noto), ripristina
    # dalla copia di riserva salvata da f1_login.py
    try:
        from fastf1.internals import f1auth
        backup = ROOT / ".secrets" / "f1tv.token"
        if backup.exists() and backup.stat().st_size > 0 \
                and f1auth.AUTH_DATA_FILE.stat().st_size == 0:
            f1auth.AUTH_DATA_FILE.write_text(backup.read_text())
            print("token ripristinato dalla copia di riserva")
    except Exception:
        pass

    from fastf1.livetiming.client import SignalRClient

    OUT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    out = Path(args.out) if args.out else OUT_DIR / f"{stamp}_{args.label}.txt"

    print(f"Registro lo stream livetiming in: {out}")
    print(f"Timeout inattivita': {args.timeout}s — Ctrl+C per fermare a mano.")
    client = SignalRClient(str(out), timeout=args.timeout, no_auth=args.no_auth)
    try:
        client.start()
    except KeyboardInterrupt:
        print("\nInterrotto a mano.")
    size = out.stat().st_size if out.exists() else 0
    print(f"Fatto: {out} ({size / 1e6:.1f} MB)")
    if size < 10_000:
        print("File quasi vuoto: probabilmente non c'era una sessione in corso.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
