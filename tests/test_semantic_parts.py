import unittest

import cv2
import numpy as np

from stitch_studio.core.image_engine import ImageEngine
from stitch_studio.core.project import QuantizationSettings, Region
from stitch_studio.core.recognition_engine import (
    DesignColor,
    RecognitionEngine,
    RecognitionMetrics,
    RecognitionResult,
)
from stitch_studio.core.semantic_parts import (
    SemanticPartExtractor,
    SemanticPartKind,
)
from stitch_studio.core.thread_db import ThreadColor


class SemanticPartExtractorTests(unittest.TestCase):
    def setUp(self):
        self.extractor = SemanticPartExtractor(max_parts=64, max_points_per_path=256)

    def test_closed_pointed_component_keeps_hole_and_tip_anchor(self):
        shape = (80, 80)
        design_map = np.zeros(shape, dtype=np.int32)
        outer = np.array(
            [[10, 65], [18, 24], [40, 5], [62, 24], [70, 65]],
            dtype=np.int32,
        )
        inner = np.array(
            [[26, 54], [31, 31], [40, 22], [49, 31], [54, 54]],
            dtype=np.int32,
        )
        cv2.fillPoly(design_map, [outer], 1)
        cv2.fillPoly(design_map, [inner], 0)
        image = np.full((*shape, 3), (220, 220, 220), dtype=np.uint8)
        image[design_map == 1] = (20, 20, 20)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={0: (220, 220, 220), 1: (20, 20, 20)},
            detail_mask=design_map == 1,
            subject_mask=np.ones(shape, dtype=bool),
        )

        pointed = next(
            part
            for part in parts
            if part.design_color_id == 1
            and part.kind == SemanticPartKind.CLOSED_CONTOUR
        )
        self.assertEqual(len(pointed.hole_paths), 1)
        self.assertGreaterEqual(len(pointed.locked_corner_indices), 2)
        tip = min(pointed.paths[0], key=lambda point: point[1])
        self.assertLessEqual(np.linalg.norm(np.asarray(tip) - (40, 5)), 2.0)

    def test_rounded_component_does_not_invent_sharp_corners(self):
        shape = (72, 72)
        design_map = np.zeros(shape, dtype=np.int32)
        cv2.ellipse(design_map, (36, 36), (15, 23), 0, 0, 360, 1, -1)
        image = np.full((*shape, 3), (240, 150, 130), dtype=np.uint8)
        image[design_map == 1] = (248, 248, 248)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={0: (240, 150, 130), 1: (248, 248, 248)},
            detail_mask=cv2.morphologyEx(
                (design_map == 1).astype(np.uint8),
                cv2.MORPH_GRADIENT,
                np.ones((3, 3), dtype=np.uint8),
            ).astype(bool),
            subject_mask=np.ones(shape, dtype=bool),
        )

        eye = next(part for part in parts if part.design_color_id == 1)
        self.assertEqual(eye.kind, SemanticPartKind.COMPACT_FILL)
        self.assertEqual(eye.locked_corner_indices, ())
        self.assertTrue(eye.paths[0][0] == eye.paths[0][-1])

    def test_open_line_is_one_continuous_non_closed_path(self):
        shape = (64, 96)
        design_map = np.zeros(shape, dtype=np.int32)
        line = np.array([[12, 46], [30, 35], [52, 39], [78, 18]], dtype=np.int32)
        cv2.polylines(design_map, [line], False, 1, 1, lineType=cv2.LINE_8)
        image = np.full((*shape, 3), (244, 180, 160), dtype=np.uint8)
        image[design_map == 1] = (18, 18, 18)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={0: (244, 180, 160), 1: (18, 18, 18)},
            detail_mask=design_map == 1,
            subject_mask=np.ones(shape, dtype=bool),
        )

        line_part = next(part for part in parts if part.design_color_id == 1)
        self.assertEqual(line_part.kind, SemanticPartKind.OPEN_LINE)
        self.assertEqual(len(line_part.paths), 1)
        path = line_part.paths[0]
        self.assertNotEqual(path[0], path[-1])
        endpoints = (np.asarray(path[0]), np.asarray(path[-1]))
        expected = (np.asarray(line[0]), np.asarray(line[-1]))
        direct = np.linalg.norm(endpoints[0] - expected[0]) + np.linalg.norm(
            endpoints[1] - expected[1]
        )
        reverse = np.linalg.norm(endpoints[0] - expected[1]) + np.linalg.norm(
            endpoints[1] - expected[0]
        )
        self.assertLessEqual(min(direct, reverse), 4.0)

    def test_independent_compact_fills_keep_their_own_nested_highlights(self):
        shape = (80, 100)
        design_map = np.zeros(shape, dtype=np.int32)
        for center in ((35, 40), (65, 40)):
            cv2.circle(design_map, center, 11, 1, -1)
            cv2.circle(design_map, (center[0] + 3, center[1] - 3), 2, 2, -1)
        image = np.full((*shape, 3), (245, 245, 245), dtype=np.uint8)
        image[design_map == 1] = (15, 15, 15)
        image[design_map == 2] = (255, 255, 255)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (245, 245, 245),
                1: (15, 15, 15),
                2: (255, 255, 255),
            },
            detail_mask=design_map != 0,
            subject_mask=np.ones(shape, dtype=bool),
        )

        pupils = [
            part
            for part in parts
            if part.design_color_id == 1
            and part.kind == SemanticPartKind.COMPACT_FILL
        ]
        highlights = [
            part
            for part in parts
            if part.design_color_id == 2
            and part.kind == SemanticPartKind.PROTECTED_HIGHLIGHT
        ]
        self.assertEqual(len(pupils), 2)
        self.assertEqual(len(highlights), 2)
        self.assertEqual(
            {part.parent_id for part in highlights},
            {part.part_id for part in pupils},
        )
        self.assertTrue(all(part.stitch_intent == "compact_fill" for part in pupils))
        self.assertTrue(
            all(part.stitch_intent == "protected_highlight" for part in highlights)
        )

    def test_highlights_are_recovered_when_quantization_connects_them_to_eye_white(self):
        shape = (72, 96)
        design_map = np.zeros(shape, dtype=np.int32)
        image = np.full((*shape, 3), (242, 132, 116), dtype=np.uint8)
        for center in ((34, 34), (62, 34)):
            cv2.ellipse(design_map, center, (12, 17), 0, 0, 360, 1, -1)
            cv2.ellipse(image, center, (12, 17), 0, 0, 360, (248, 248, 248), -1)
            cv2.circle(design_map, center, 6, 2, -1)
            cv2.circle(image, center, 6, (18, 18, 18), -1)
            highlight_center = (center[0] + 3, center[1] - 3)
            cv2.circle(image, highlight_center, 2, (255, 255, 255), -1)
            cv2.circle(design_map, highlight_center, 1, 1, -1)
            # Simulate an antialias bridge that makes the highlight part of
            # the larger eye-white component in the quantized label map.
            cv2.line(
                design_map,
                highlight_center,
                (center[0] + 6, center[1] - 6),
                1,
                1,
            )

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (242, 132, 116),
                1: (248, 248, 248),
                2: (18, 18, 18),
            },
            detail_mask=design_map != 0,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={0: 0, 1: 1, 2: 2},
        )

        highlights = [
            part
            for part in parts
            if part.kind == SemanticPartKind.PROTECTED_HIGHLIGHT
        ]
        self.assertEqual(len(highlights), 2)
        self.assertTrue(all(part.design_color_id == 1 for part in highlights))
        self.assertTrue(all(part.thread_index == 1 for part in highlights))
        self.assertTrue(all(3 <= part.area <= 20 for part in highlights))

    def test_recognition_emits_semantic_parts_before_thread_color_collapse(self):
        shape = (72, 88)
        image = np.full((*shape, 3), (238, 130, 115), dtype=np.uint8)
        cv2.ellipse(image, (36, 32), (12, 17), 0, 0, 360, (250, 250, 250), -1)
        cv2.ellipse(image, (55, 32), (12, 17), 0, 0, 360, (246, 246, 246), -1)
        cv2.circle(image, (38, 34), 5, (18, 18, 18), -1)
        cv2.circle(image, (56, 34), 5, (24, 24, 24), -1)
        cv2.polylines(
            image,
            [np.array([[29, 53], [44, 60], [64, 52]], dtype=np.int32)],
            False,
            (20, 20, 20),
            1,
        )
        threads = [
            ThreadColor(name="Coral", color_rgb=(240, 128, 112)),
            ThreadColor(name="White", color_rgb=(250, 250, 250)),
            ThreadColor(name="Black", color_rgb=(20, 20, 20)),
        ]

        result = RecognitionEngine.recognize(
            image,
            threads,
            QuantizationSettings(
                n_colors=3,
                design_color_budget=8,
                preserve_details=True,
                include_background=True,
            ),
        )

        self.assertGreaterEqual(len(result.semantic_parts), 5)
        self.assertTrue(
            any(
                part.kind == SemanticPartKind.OPEN_LINE
                for part in result.semantic_parts
            )
        )
        self.assertGreaterEqual(
            len(
                [
                    part
                    for part in result.semantic_parts
                    if part.kind == SemanticPartKind.COMPACT_FILL
                ]
            ),
            2,
        )
        self.assertTrue(
            all(part.thread_index is not None for part in result.semantic_parts)
        )

    def test_region_semantic_metadata_round_trips_without_affecting_legacy_data(self):
        region = Region(
            semantic_part_id="d2-c4",
            semantic_kind="open_line",
            semantic_role="line_detail",
            semantic_parent_id="d2-c1",
        )

        restored = Region.from_dict(region.to_dict())
        legacy = Region.from_dict({"name": "Legacy"})

        self.assertEqual(restored.semantic_part_id, "d2-c4")
        self.assertEqual(restored.semantic_kind, "open_line")
        self.assertEqual(restored.semantic_role, "line_detail")
        self.assertEqual(restored.semantic_parent_id, "d2-c1")
        self.assertIsNone(legacy.semantic_part_id)
        self.assertIsNone(legacy.semantic_kind)

    def test_photo_and_cross_layers_consume_typed_open_and_closed_parts(self):
        shape = (72, 96)
        design_map = np.zeros(shape, dtype=np.int32)
        pointed_ring = np.array(
            [[28, 22], [47, 15], [67, 22], [63, 42], [48, 51], [32, 42]],
            dtype=np.int32,
        )
        pointed_hole = np.array(
            [[35, 26], [47, 21], [60, 26], [57, 36], [48, 42], [38, 36]],
            dtype=np.int32,
        )
        cv2.fillPoly(design_map, [pointed_ring], 1)
        cv2.fillPoly(design_map, [pointed_hole], 0)
        open_line = np.array([[18, 61], [38, 56], [61, 60], [82, 53]], dtype=np.int32)
        cv2.polylines(design_map, [open_line], False, 1, 1)
        image = np.full((*shape, 3), (240, 140, 120), dtype=np.uint8)
        image[design_map == 1] = (20, 20, 20)
        threads = [
            ThreadColor(name="Coral", color_rgb=(240, 140, 120)),
            ThreadColor(name="Black", color_rgb=(20, 20, 20)),
        ]
        detail = design_map == 1
        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={0: (240, 140, 120), 1: (20, 20, 20)},
            detail_mask=detail,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={0: 0, 1: 1},
        )
        recognition = self._recognition_result(
            image,
            design_map,
            detail,
            parts,
            threads,
        )

        photo_layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            image,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )
        cross_layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            image,
            generation_mode="cross_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        photo_semantic = [
            region
            for layer in photo_layers
            for region in layer.regions
            if region.semantic_part_id is not None
        ]
        cross_semantic = [
            region
            for layer in cross_layers
            for region in layer.regions
            if region.semantic_part_id is not None
        ]
        self.assertEqual(
            {region.semantic_kind for region in photo_semantic},
            {"open_line", "closed_contour"},
        )
        open_region = next(
            region for region in photo_semantic if region.semantic_kind == "open_line"
        )
        closed_region = next(
            region
            for region in photo_semantic
            if region.semantic_kind == "closed_contour"
        )
        self.assertEqual(open_region.stitch_settings.fill_mode, "run")
        self.assertFalse(open_region.stitch_settings.run_trace_contour)
        self.assertEqual(closed_region.stitch_settings.fill_mode, "run")
        self.assertTrue(closed_region.stitch_settings.run_trace_contour)
        self.assertEqual(closed_region.stitch_settings.run_corner_mode, "adaptive")
        self.assertTrue(all(region.is_cross_stitch_overlay for region in cross_semantic))
        self.assertTrue(
            any(
                region.stitch_settings.fill_mode == "cross_stitch"
                for layer in cross_layers
                for region in layer.regions
            )
        )

    @staticmethod
    def _recognition_result(image, design_map, detail, parts, threads):
        metrics = RecognitionMetrics(1.0, 1.0, 1.0, 1.0)
        colors = [
            DesignColor(0, (240, 140, 120), int(np.count_nonzero(design_map == 0)), 0, 0.0),
            DesignColor(1, (20, 20, 20), int(np.count_nonzero(design_map == 1)), 1, 0.0),
        ]
        thread_map = design_map.copy()
        palette = np.asarray([thread.color_rgb for thread in threads], dtype=np.uint8)
        return RecognitionResult(
            design_map=design_map,
            design_colors=colors,
            reconstructed_rgb=image.copy(),
            detail_mask=detail,
            detail_design_ids=(1,),
            metrics=metrics,
            subject_mask=np.ones(design_map.shape, dtype=bool),
            thread_map=thread_map,
            thread_reconstructed_rgb=palette[thread_map],
            thread_metrics=metrics,
            subject_metrics=metrics,
            feature_outline_mask=detail,
            feature_outline_groups=(),
            semantic_parts=parts,
        )


if __name__ == "__main__":
    unittest.main()
