#!/usr/bin/env python3
import sys
import json
import time


def out(obj):
    print(json.dumps(obj))
    sys.stdout.flush()


def main():
    try:
        import Quartz
    except Exception as e:
        out({"ok": False, "error": "Quartz unavailable: %s" % e})
        return

    if not Quartz.CGPreflightPostEventAccess():
        out({"ok": False, "error": "no accessibility permission"})
        return

    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"

    if cmd == "status":
        out({"ok": True, "trusted": True})
        return

    if cmd == "click":
        x = float(sys.argv[2])
        y = float(sys.argv[3])
        for dx, dy, d in ((-4, -3, 0.05), (3, 2, 0.045), (0, 0, 0.07)):
            ev = Quartz.CGEventCreateMouseEvent(
                None, Quartz.kCGEventMouseMoved, (x + dx, y + dy), Quartz.kCGMouseButtonLeft
            )
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
            time.sleep(d)
        down = Quartz.CGEventCreateMouseEvent(
            None, Quartz.kCGEventLeftMouseDown, (x, y), Quartz.kCGMouseButtonLeft
        )
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
        time.sleep(0.06)
        up = Quartz.CGEventCreateMouseEvent(
            None, Quartz.kCGEventLeftMouseUp, (x, y), Quartz.kCGMouseButtonLeft
        )
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
        out({"ok": True, "x": x, "y": y})
        return

    out({"ok": False, "error": "unknown command: %s" % cmd})


if __name__ == "__main__":
    main()
