"""Fast production smoke check for the Cloudflare R2 archive credentials."""

import datetime
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from r2_archive import archive_json, configured, configuration, verify_json


def main():
    if not configured():
        print("R2 archive check failed: one or more R2 secrets are missing.")
        return 1

    try:
        configuration()
    except ValueError as exc:
        print(f"R2 archive check failed: {exc}")
        return 1

    now = datetime.datetime.now(datetime.timezone.utc)
    day = now.date().isoformat()
    payload = {
        "schema": 1,
        "status": "connected",
        "checkedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    ok = archive_json("system", day, payload)
    if not ok:
        print("R2 archive check failed; see the warning above.")
        return 1
    try:
        verify_json("system", day, payload)
    except Exception as exc:
        print(f"R2 archive readback failed ({type(exc).__name__}). "
              "Check object read permission and the configured destination.")
        return 1
    print("R2 archive connection verified by upload and readback.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
