"""Copy the effects the game uses out of the Super Pixel Effects Gigapack into assets/fx.

Writes assets/fx/<key>.png (the spritesheet) and assets/fx/fx.json (frame rectangles).
Only these files are committed; the full pack stays out of git (its license forbids
redistributing the pack itself).

Usage:  python tools/prepare_fx.py
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "assets" / "Super Pixel Effects Gigapack (Free Version)" / "spritesheet"
OUT = ROOT / "assets" / "fx"

FX = {
    "impact": "Impacts/symmetrical_impact_001/symmetrical_impact_001_large_yellow",
    "hit": "Impacts/directional_impact_001/directional_impact_001_large_blue",
    "skip": "Symbols/symbol_failure_001/symbol_failure_001_large_red",
    "warp": "Sci-fi/scifi_warp_001/scifi_warp_001_large_green",
    "bolt": "Lightning/lightning_strike_001/lightning_strike_001_large_violet",
    "lightning": "Lightning/lightning_burst_001/lightning_burst_001_large_violet",
    "boom10": "Explosions/epic_explosion_002/epic_explosion_002_large_yellow",
    "koBoom": "Explosions/epic_explosion_001/epic_explosion_001_large_orange",
    "skull": "Smoke Bursts/stylized_skull_smoke_burst_001/stylized_skull_smoke_burst_001_large_white",
    "shield": "Fantasy Spells/spell_defense_up_001/spell_defense_up_001_large_blue",
    "absorb": "Fantasy Spells/spell_absorb_001/spell_absorb_001_large_violet",
    "smoke": "Smoke Bursts/directional_smoke_burst_001/directional_smoke_burst_001_large_white",
    "light": "Magic Bursts/round_light_burst_001/round_light_burst_001_large_yellow",
    "sparkle": "Magic Bursts/round_sparkle_burst_001/round_sparkle_burst_001_large_blue",
    "sparkle2": "Magic Bursts/round_sparkle_burst_002/round_sparkle_burst_002_large_green",
    "firework": "Magic Bursts/round_firework_burst_001/round_firework_burst_001_large_green",
    "firework2": "Magic Bursts/round_firework_burst_002/round_firework_burst_002_large_yellow",
    "heartbeat": "Sci-fi/scifi_heartbeat_fast_001/scifi_heartbeat_fast_001_large_yellow",
    "crown": "Symbols/symbol_crown_001/symbol_crown_001_large_yellow",
    "gameOver": "Symbols/symbol_game_over_text_001/symbol_game_over_text_001_large_red",
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"fps": 15, "credit": "Super Pixel Effects Gigapack - Will Tice / unTied Games", "fx": {}}
    for key, rel in FX.items():
        src = PACK / rel
        shutil.copyfile(src / "spritesheet.png", OUT / f"{key}.png")
        frames = []
        for line in (src / "spritesheet.txt").read_text().splitlines():
            if "=" in line:
                frames.append([int(v) for v in line.split("=")[1].split()])
        meta["fx"][key] = {"src": f"{key}.png", "frames": frames}
    (OUT / "fx.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {len(FX)} effects to {OUT}")


if __name__ == "__main__":
    main()
