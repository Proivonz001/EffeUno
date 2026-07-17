"""Login F1TV una tantum, con salvataggio garantito del token.

Workaround: in fastf1 3.8.3 il login via estensione riesce ma il token
non sempre viene persistito su disco (f1auth.json resta vuoto), e al run
successivo il flusso ricomincia. Qui chiamiamo lo stesso get_auth_token
ufficiale e poi scriviamo noi il token, verificandolo.

Uso:  .venv/Scripts/python.exe scripts/f1_login.py
Poi apri l'URL stampato, fai login/Connect, e controlla che dica
"token salvato". Da quel momento record_live.py parte senza domande.
"""

import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    from fastf1.internals import f1auth

    token = f1auth.get_auth_token()
    if not token:
        print("login fallito: nessun token ricevuto")
        return 1
    f1auth.AUTH_DATA_FILE.write_text(token)
    saved = f1auth.AUTH_DATA_FILE.read_text()
    if saved == token:
        print(f"token salvato ({len(token)} byte) in {f1auth.AUTH_DATA_FILE}")
        return 0
    print("scrittura non riuscita")
    return 1


if __name__ == "__main__":
    sys.exit(main())
