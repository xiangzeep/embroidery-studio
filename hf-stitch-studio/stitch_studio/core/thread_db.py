"""
Thread Database System
Manages thread packs (collections), individual thread colors, and thread types.
Supports import/export in JSON and CSV, CIEDE2000 color matching.
"""

import json
import csv
import os
import uuid
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Tuple
from enum import Enum
import numpy as np


class ThreadType(Enum):
    MATTE = "matte"
    SHINY = "shiny"
    METALLIC = "metallic"
    NEON = "neon"
    UV = "uv"
    GLOW_IN_DARK = "glow_in_dark"
    VARIEGATED = "variegated"
    SILK = "silk"
    COTTON = "cotton"
    POLYESTER = "polyester"
    RAYON = "rayon"
    WOOL = "wool"
    OTHER = "other"


@dataclass
class ThreadColor:
    """A single thread spool with color, type and metadata."""
    uid: str = ""
    name: str = ""
    brand: str = ""
    catalog_number: str = ""
    color_rgb: Tuple[int, int, int] = (0, 0, 0)
    thread_type: str = "matte"
    weight: str = "40"
    owned_quantity: int = 1
    notes: str = ""

    def __post_init__(self):
        if not self.uid:
            self.uid = str(uuid.uuid4())[:8]
        if isinstance(self.color_rgb, list):
            self.color_rgb = tuple(self.color_rgb)

    @property
    def hex_color(self) -> str:
        r, g, b = self.color_rgb
        return f"#{r:02x}{g:02x}{b:02x}"

    @property
    def rgb_int(self) -> int:
        r, g, b = self.color_rgb
        return (r << 16) | (g << 8) | b

    def to_lab(self) -> np.ndarray:
        """Convert RGB to CIELAB for perceptual comparison."""
        from skimage.color import rgb2lab
        pixel = np.array([[self.color_rgb]], dtype=np.float64) / 255.0
        lab = rgb2lab(pixel)
        return lab[0, 0]

    def to_dict(self) -> dict:
        d = {
            'uid': self.uid,
            'name': self.name,
            'brand': self.brand,
            'catalog_number': self.catalog_number,
            'color_rgb': list(self.color_rgb),
            'thread_type': self.thread_type,
            'weight': self.weight,
            'owned_quantity': self.owned_quantity,
            'notes': self.notes,
        }
        return d

    @classmethod
    def from_dict(cls, d: dict) -> 'ThreadColor':
        d = dict(d)
        if 'color_rgb' in d:
            d['color_rgb'] = tuple(d['color_rgb'])
        return cls(**d)


@dataclass
class ThreadPack:
    """A collection of threads (a brand pack, a custom set, etc.)."""
    uid: str = ""
    name: str = "New Thread Pack"
    brand: str = ""
    description: str = ""
    pack_type: str = "custom"  # "brand", "custom", "project"
    threads: List[ThreadColor] = field(default_factory=list)

    def __post_init__(self):
        if not self.uid:
            self.uid = str(uuid.uuid4())[:8]

    def add_thread(self, thread: ThreadColor):
        self.threads.append(thread)

    def remove_thread(self, uid: str):
        self.threads = [t for t in self.threads if t.uid != uid]

    def get_thread(self, uid: str) -> Optional[ThreadColor]:
        for t in self.threads:
            if t.uid == uid:
                return t
        return None

    def get_palette_rgb(self) -> np.ndarray:
        """Return Nx3 array of RGB values for all threads."""
        if not self.threads:
            return np.zeros((0, 3), dtype=np.float64)
        return np.array([t.color_rgb for t in self.threads], dtype=np.float64)

    def get_palette_lab(self) -> np.ndarray:
        """Return Nx3 array of CIELAB values for all threads."""
        from skimage.color import rgb2lab
        rgb = self.get_palette_rgb()
        if len(rgb) == 0:
            return np.zeros((0, 3), dtype=np.float64)
        rgb_img = rgb.reshape(1, -1, 3) / 255.0
        lab_img = rgb2lab(rgb_img)
        return lab_img[0]

    def to_dict(self) -> dict:
        return {
            'uid': self.uid,
            'name': self.name,
            'brand': self.brand,
            'description': self.description,
            'pack_type': self.pack_type,
            'threads': [t.to_dict() for t in self.threads],
        }

    @classmethod
    def from_dict(cls, d: dict) -> 'ThreadPack':
        d = dict(d)
        threads = [ThreadColor.from_dict(td) for td in d.pop('threads', [])]
        pack = cls(**d)
        pack.threads = threads
        return pack


class ThreadDatabase:
    """
    Manages multiple thread packs. Persists to JSON.
    Supports import/export of individual packs as JSON or CSV.
    """

    def __init__(self, db_path: str = ""):
        self.db_path = db_path or os.path.join(
            os.path.expanduser("~"), ".stitch_studio", "thread_db.json"
        )
        self.packs: List[ThreadPack] = []
        self._ensure_dir()

    def _ensure_dir(self):
        d = os.path.dirname(self.db_path)
        if d:
            os.makedirs(d, exist_ok=True)

    # --- Persistence ---

    def save(self):
        data = {'packs': [p.to_dict() for p in self.packs]}
        with open(self.db_path, 'w') as f:
            json.dump(data, f, indent=2)

    def load(self):
        if not os.path.exists(self.db_path):
            self._create_default_packs()
            self.save()
            return
        with open(self.db_path, 'r') as f:
            data = json.load(f)
        self.packs = [ThreadPack.from_dict(pd) for pd in data.get('packs', [])]

    # --- Pack Management ---

    def add_pack(self, pack: ThreadPack):
        self.packs.append(pack)

    def remove_pack(self, uid: str):
        self.packs = [p for p in self.packs if p.uid != uid]

    def get_pack(self, uid: str) -> Optional[ThreadPack]:
        for p in self.packs:
            if p.uid == uid:
                return p
        return None

    def get_all_threads(self) -> List[ThreadColor]:
        """Flat list of all threads across all packs."""
        result = []
        for p in self.packs:
            result.extend(p.threads)
        return result

    def get_combined_palette_rgb(self) -> np.ndarray:
        """Combined palette of all owned threads."""
        all_threads = self.get_all_threads()
        if not all_threads:
            return np.zeros((0, 3), dtype=np.float64)
        return np.array([t.color_rgb for t in all_threads], dtype=np.float64)

    # --- Import / Export ---

    def export_pack_json(self, pack_uid: str, filepath: str):
        pack = self.get_pack(pack_uid)
        if pack is None:
            raise ValueError(f"Pack {pack_uid} not found")
        with open(filepath, 'w') as f:
            json.dump(pack.to_dict(), f, indent=2)

    def import_pack_json(self, filepath: str) -> ThreadPack:
        with open(filepath, 'r') as f:
            data = json.load(f)
        pack = ThreadPack.from_dict(data)
        pack.uid = str(uuid.uuid4())[:8]  # new uid to avoid collisions
        self.packs.append(pack)
        return pack

    def export_pack_csv(self, pack_uid: str, filepath: str):
        pack = self.get_pack(pack_uid)
        if pack is None:
            raise ValueError(f"Pack {pack_uid} not found")
        with open(filepath, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                'name', 'brand', 'catalog_number', 'r', 'g', 'b',
                'thread_type', 'weight', 'quantity', 'notes'
            ])
            for t in pack.threads:
                r, g, b = t.color_rgb
                writer.writerow([
                    t.name, t.brand, t.catalog_number,
                    r, g, b, t.thread_type, t.weight,
                    t.owned_quantity, t.notes
                ])

    def import_pack_csv(self, filepath: str, pack_name: str = "") -> ThreadPack:
        pack = ThreadPack(name=pack_name or os.path.basename(filepath))
        with open(filepath, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                t = ThreadColor(
                    name=row.get('name', ''),
                    brand=row.get('brand', ''),
                    catalog_number=row.get('catalog_number', ''),
                    color_rgb=(
                        int(row.get('r', 0)),
                        int(row.get('g', 0)),
                        int(row.get('b', 0))
                    ),
                    thread_type=row.get('thread_type', 'matte'),
                    weight=row.get('weight', '40'),
                    owned_quantity=int(row.get('quantity', 1)),
                    notes=row.get('notes', ''),
                )
                pack.threads.append(t)
        self.packs.append(pack)
        return pack

    # --- Color Matching ---

    def find_nearest_thread(self, rgb: Tuple[int, int, int]) -> Optional[ThreadColor]:
        """Find the closest thread to a given RGB color using CIEDE2000."""
        from skimage.color import rgb2lab, deltaE_ciede2000
        all_threads = self.get_all_threads()
        if not all_threads:
            return None

        target_lab = rgb2lab(np.array([[rgb]], dtype=np.float64) / 255.0)[0, 0]
        palette_rgb = np.array([t.color_rgb for t in all_threads], dtype=np.float64)
        palette_lab = rgb2lab(palette_rgb.reshape(1, -1, 3) / 255.0)[0]

        # CIEDE2000 distances
        diffs = deltaE_ciede2000(
            target_lab.reshape(1, 1, 3),
            palette_lab.reshape(1, -1, 3)
        )[0]

        best_idx = int(np.argmin(diffs))
        return all_threads[best_idx]

    def find_nearest_threads(self, rgb: Tuple[int, int, int], n: int = 5) -> List[Tuple[ThreadColor, float]]:
        """Return top-n nearest threads with their CIEDE2000 distances."""
        from skimage.color import rgb2lab, deltaE_ciede2000
        all_threads = self.get_all_threads()
        if not all_threads:
            return []

        target_lab = rgb2lab(np.array([[rgb]], dtype=np.float64) / 255.0)[0, 0]
        palette_rgb = np.array([t.color_rgb for t in all_threads], dtype=np.float64)
        palette_lab = rgb2lab(palette_rgb.reshape(1, -1, 3) / 255.0)[0]

        diffs = deltaE_ciede2000(
            target_lab.reshape(1, 1, 3),
            palette_lab.reshape(1, -1, 3)
        )[0]

        indices = np.argsort(diffs)[:n]
        return [(all_threads[i], float(diffs[i])) for i in indices]

    # --- Defaults ---

    def _create_default_packs(self):
        """Create a starter set of common thread colors."""
        basic = ThreadPack(
            name="Basic Starter Pack",
            brand="Generic",
            description="A default set of common embroidery colors",
            pack_type="brand"
        )
        basic_colors = [
            ("White", (255, 255, 255)), ("Black", (0, 0, 0)),
            ("Red", (220, 30, 30)), ("Dark Red", (139, 0, 0)),
            ("Orange", (255, 140, 0)), ("Gold", (218, 165, 32)),
            ("Yellow", (255, 215, 0)), ("Light Yellow", (255, 255, 180)),
            ("Lime Green", (50, 205, 50)), ("Green", (0, 128, 0)),
            ("Dark Green", (0, 80, 0)), ("Teal", (0, 128, 128)),
            ("Light Blue", (135, 206, 250)), ("Blue", (0, 70, 200)),
            ("Navy", (0, 0, 128)), ("Purple", (128, 0, 128)),
            ("Violet", (148, 103, 189)), ("Pink", (255, 105, 180)),
            ("Hot Pink", (255, 20, 147)), ("Brown", (139, 69, 19)),
            ("Tan", (210, 180, 140)), ("Light Gray", (192, 192, 192)),
            ("Medium Gray", (128, 128, 128)), ("Dark Gray", (64, 64, 64)),
            ("Ivory", (255, 255, 240)), ("Peach", (255, 218, 185)),
            ("Coral", (255, 127, 80)), ("Burgundy", (128, 0, 32)),
            ("Olive", (128, 128, 0)), ("Mint", (152, 255, 152)),
            ("Lavender", (200, 162, 200)), ("Sky Blue", (120, 190, 255)),
        ]
        for name, rgb in basic_colors:
            basic.add_thread(ThreadColor(
                name=name, brand="Generic", color_rgb=rgb,
                thread_type="polyester", weight="40"
            ))
        self.packs.append(basic)

        metallic = ThreadPack(
            name="Metallic Pack",
            brand="Generic",
            description="Metallic thread collection",
            pack_type="custom"
        )
        metallic_colors = [
            ("Gold Metallic", (212, 175, 55)),
            ("Silver Metallic", (192, 192, 192)),
            ("Copper Metallic", (184, 115, 51)),
            ("Bronze Metallic", (150, 116, 68)),
            ("Rose Gold Metallic", (183, 110, 121)),
            ("Blue Metallic", (80, 100, 200)),
            ("Red Metallic", (200, 50, 50)),
            ("Green Metallic", (50, 150, 80)),
        ]
        for name, rgb in metallic_colors:
            metallic.add_thread(ThreadColor(
                name=name, brand="Generic", color_rgb=rgb,
                thread_type="metallic", weight="40"
            ))
        self.packs.append(metallic)
