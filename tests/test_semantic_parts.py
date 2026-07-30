import unittest

import cv2
import numpy as np

from stitch_studio.core.image_engine import ImageEngine
from stitch_studio.core.project import (
    Layer,
    QuantizationSettings,
    Region,
    StitchSettings,
)
from stitch_studio.core.recognition_engine import (
    DesignColor,
    RecognitionEngine,
    RecognitionMetrics,
    RecognitionResult,
)
from stitch_studio.core.semantic_parts import (
    SemanticPart,
    SemanticPartExtractor,
    SemanticPartKind,
)
from stitch_studio.core.stitch_engine import StitchEngine
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

    def test_same_thread_antialias_fragments_merge_into_one_supported_guide(self):
        shape = (48, 88)
        design_map = np.zeros(shape, dtype=np.int32)
        image = np.full((*shape, 3), (244, 142, 121), dtype=np.uint8)
        for index, start in enumerate(range(10, 76, 6)):
            design_id = 1 if index % 2 == 0 else 2
            end = min(76, start + 6)
            design_map[22:25, start:end] = design_id
            image[22:25, start:end] = (
                (18, 18, 18) if design_id == 1 else (42, 42, 42)
            )
        detail = np.zeros(shape, dtype=bool)
        detail[21:26, 9:77] = True

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (244, 142, 121),
                1: (18, 18, 18),
                2: (42, 42, 42),
            },
            detail_mask=detail,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={1: 3, 2: 3},
        )

        lines = [
            part
            for part in parts
            if part.kind == SemanticPartKind.OPEN_LINE and part.thread_index == 3
        ]
        self.assertEqual(len(lines), 1)
        xs = [point[0] for point in lines[0].paths[0]]
        self.assertLessEqual(min(xs), 11.0)
        self.assertGreaterEqual(max(xs), 74.0)

    def test_duplicate_design_ids_with_identical_thread_color_form_one_part(self):
        shape = (56, 72)
        design_map = np.zeros(shape, dtype=np.int32)
        design_map[12:44, 10:36] = 1
        design_map[12:44, 36:62] = 2
        image = np.full((*shape, 3), (245, 245, 245), dtype=np.uint8)
        image[design_map != 0] = (32, 38, 93)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (245, 245, 245),
                1: (32, 38, 93),
                2: (32, 38, 93),
            },
            detail_mask=design_map != 0,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={1: 4, 2: 4},
        )

        merged = [part for part in parts if part.thread_index == 4]
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].area, 32 * 52)

    def test_same_thread_antialias_rim_is_absorbed_into_adjacent_fill(self):
        shape = (64, 80)
        design_map = np.zeros(shape, dtype=np.int32)
        design_map[12:52, 12:48] = 1
        design_map[20:43, 48] = 2
        image = np.full((*shape, 3), (250, 250, 250), dtype=np.uint8)
        image[design_map == 1] = (255, 113, 0)
        image[design_map == 2] = (142, 76, 47)
        detail = design_map == 2

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (250, 250, 250),
                1: (255, 113, 0),
                2: (142, 76, 47),
            },
            detail_mask=detail,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={1: 3, 2: 3},
        )

        same_thread = [part for part in parts if part.thread_index == 3]
        self.assertTrue(same_thread)
        self.assertFalse(
            any(part.kind == SemanticPartKind.OPEN_LINE for part in same_thread)
        )

    def test_tiny_cross_thread_antialias_blend_is_not_a_semantic_part(self):
        shape = (48, 64)
        design_map = np.zeros(shape, dtype=np.int32)
        design_map[:, 32:] = 1
        design_map[20:26, 31] = 2
        image = np.full((*shape, 3), (32, 38, 93), dtype=np.uint8)
        image[design_map == 1] = (255, 113, 0)
        image[design_map == 2] = (144, 76, 46)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (32, 38, 93),
                1: (255, 113, 0),
                2: (144, 76, 46),
            },
            detail_mask=design_map == 2,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={0: 0, 1: 1, 2: 2},
        )

        self.assertFalse(any(part.design_color_id == 2 for part in parts))

    def test_tiny_non_blended_line_remains_a_semantic_part(self):
        shape = (48, 64)
        design_map = np.zeros(shape, dtype=np.int32)
        design_map[:, 32:] = 1
        design_map[20:26, 31] = 2
        image = np.full((*shape, 3), (32, 38, 93), dtype=np.uint8)
        image[design_map == 1] = (255, 113, 0)
        image[design_map == 2] = (15, 210, 70)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (32, 38, 93),
                1: (255, 113, 0),
                2: (15, 210, 70),
            },
            detail_mask=design_map == 2,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={0: 0, 1: 1, 2: 2},
        )

        detail = [part for part in parts if part.design_color_id == 2]
        self.assertEqual(len(detail), 1)
        self.assertEqual(detail[0].kind, SemanticPartKind.OPEN_LINE)

    def test_same_thread_corner_extension_is_not_absorbed_into_fill(self):
        shape = (72, 96)
        design_map = np.zeros(shape, dtype=np.int32)
        design_map[20:58, 24:72] = 1
        corner = np.array(
            [[24, 30], [17, 24], [12, 24], [17, 30]],
            dtype=np.int32,
        )
        cv2.polylines(design_map, [corner], False, 2, 2)
        image = np.full((*shape, 3), (245, 145, 122), dtype=np.uint8)
        image[design_map == 1] = (24, 24, 24)
        image[design_map == 2] = (42, 42, 42)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (245, 145, 122),
                1: (24, 24, 24),
                2: (42, 42, 42),
            },
            detail_mask=design_map == 1,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={0: 0, 1: 1, 2: 1},
        )

        corner_parts = [
            part
            for part in parts
            if part.thread_index == 1
            and part.design_color_id == 2
            and part.kind in (
                SemanticPartKind.OPEN_LINE,
                SemanticPartKind.CLOSED_CONTOUR,
            )
        ]
        self.assertEqual(len(corner_parts), 1)
        self.assertLess(
            min(point[0] for point in corner_parts[0].paths[0]),
            20.0,
        )

    def test_nested_compact_fill_keeps_explicit_parent_and_higher_z_order(self):
        shape = (72, 88)
        design_map = np.zeros(shape, dtype=np.int32)
        image = np.full((*shape, 3), (242, 132, 116), dtype=np.uint8)
        mouth = np.array(
            [[22, 20], [66, 20], [61, 55], [27, 55]],
            dtype=np.int32,
        )
        cv2.fillPoly(design_map, [mouth], 1)
        cv2.fillPoly(image, [mouth], (82, 18, 25))
        cv2.ellipse(design_map, (44, 45), (13, 7), 0, 0, 360, 2, -1)
        cv2.ellipse(image, (44, 45), (13, 7), 0, 0, 360, (190, 35, 82), -1)

        parts = self.extractor.extract(
            image=image,
            design_map=design_map,
            design_colors={
                0: (242, 132, 116),
                1: (82, 18, 25),
                2: (190, 35, 82),
            },
            detail_mask=design_map != 0,
            subject_mask=np.ones(shape, dtype=bool),
            thread_matches={1: 1, 2: 2},
        )

        mouth_part = max(
            (part for part in parts if part.design_color_id == 1),
            key=lambda part: part.area,
        )
        tongue_part = max(
            (part for part in parts if part.design_color_id == 2),
            key=lambda part: part.area,
        )
        self.assertEqual(mouth_part.kind, SemanticPartKind.COMPACT_FILL)
        self.assertEqual(tongue_part.kind, SemanticPartKind.COMPACT_FILL)
        self.assertEqual(tongue_part.parent_id, mouth_part.part_id)
        self.assertGreater(tongue_part.z_order, mouth_part.z_order)
        parent_layer = Layer(
            is_detail_layer=True,
            regions=[
                Region(
                    mask=mouth_part.mask.astype(np.uint8) * 255,
                    semantic_part_id=mouth_part.part_id,
                    semantic_z_order=mouth_part.z_order,
                )
            ],
        )
        child_layer = Layer(
            is_detail_layer=True,
            regions=[
                Region(
                    mask=tongue_part.mask.astype(np.uint8) * 255,
                    semantic_part_id=tongue_part.part_id,
                    semantic_parent_id=tongue_part.parent_id,
                    semantic_z_order=tongue_part.z_order,
                )
            ],
        )
        self.assertLess(
            ImageEngine._layer_sort_key(child_layer),
            ImageEngine._layer_sort_key(parent_layer),
        )

    def test_broad_background_contour_is_not_duplicated_as_semantic_run(self):
        shape = (80, 120)
        mask = np.zeros(shape, dtype=bool)
        mask[14:35, :] = True
        contour = (
            (0.0, 14.0),
            (119.0, 14.0),
            (119.0, 34.0),
            (0.0, 34.0),
            (0.0, 14.0),
        )
        background = SemanticPart(
            part_id="background-band",
            kind=SemanticPartKind.CLOSED_CONTOUR,
            role="feature_outline",
            design_color_id=1,
            source_color_rgb=(50, 90, 170),
            thread_index=1,
            mask=mask,
            paths=(contour,),
            subject_confidence=0.02,
            detail_confidence=1.0,
        )
        subject_mask = np.zeros(shape, dtype=bool)
        subject_mask[14:21, :] = True
        subject = SemanticPart(
            **{
                **background.__dict__,
                "part_id": "subject-band",
                "subject_confidence": 0.95,
                "mask": subject_mask,
            }
        )

        self.assertFalse(
            ImageEngine._should_append_semantic_part(
                background,
                shape,
                generation_mode="cross_stitch",
            )
        )
        self.assertTrue(
            ImageEngine._should_append_semantic_part(
                subject,
                shape,
                generation_mode="cross_stitch",
            )
        )

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
            semantic_kind="closed_contour",
            semantic_role="line_detail",
            semantic_parent_id="d2-c1",
            semantic_z_order=31,
            scene_plane="background_detail",
            guide_paths_px=[
                [(4.0, 8.0), (12.0, 8.0), (12.0, 2.0)],
            ],
            guide_paths_closed=[True],
            guide_corner_indices=[[0, 2]],
        )

        restored = Region.from_dict(region.to_dict())
        legacy = Region.from_dict({"name": "Legacy"})

        self.assertEqual(restored.semantic_part_id, "d2-c4")
        self.assertEqual(restored.semantic_kind, "closed_contour")
        self.assertEqual(restored.semantic_role, "line_detail")
        self.assertEqual(restored.semantic_parent_id, "d2-c1")
        self.assertEqual(restored.semantic_z_order, 31)
        self.assertEqual(restored.scene_plane, "background_detail")
        self.assertEqual(restored.guide_paths_px, region.guide_paths_px)
        self.assertEqual(restored.guide_paths_closed, [True])
        self.assertEqual(restored.guide_corner_indices, [[0, 2]])
        self.assertIsNone(legacy.semantic_part_id)
        self.assertIsNone(legacy.semantic_kind)
        self.assertEqual(legacy.semantic_z_order, 0)
        self.assertEqual(legacy.scene_plane, "subject_base")
        self.assertEqual(legacy.guide_paths_px, [])
        self.assertEqual(legacy.guide_paths_closed, [])
        self.assertEqual(legacy.guide_corner_indices, [])

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
        self.assertEqual(len(open_region.guide_paths_px), 1)
        self.assertGreaterEqual(len(open_region.guide_paths_px[0]), 2)
        self.assertEqual(closed_region.stitch_settings.fill_mode, "run")
        self.assertTrue(closed_region.stitch_settings.run_trace_contour)
        self.assertEqual(closed_region.stitch_settings.run_corner_mode, "adaptive")
        closed_part = next(
            part
            for part in recognition.semantic_parts
            if part.kind == SemanticPartKind.CLOSED_CONTOUR
        )
        nested_child = any(
            part.parent_id == closed_part.part_id
            for part in recognition.semantic_parts
        )
        expected_path_count = len(closed_part.paths)
        if not nested_child:
            expected_path_count += len(closed_part.hole_paths)
        self.assertEqual(len(closed_region.guide_paths_px), expected_path_count)
        self.assertTrue(all(closed_region.guide_paths_closed))
        self.assertEqual(
            closed_region.guide_corner_indices[0],
            list(closed_part.locked_corner_indices),
        )
        self.assertTrue(all(region.is_cross_stitch_overlay for region in cross_semantic))
        self.assertTrue(
            any(
                region.stitch_settings.fill_mode == "cross_stitch"
                for layer in cross_layers
                for region in layer.regions
            )
        )

    def test_nested_child_replaces_redundant_parent_hole_outline(self):
        shape = (100, 100)
        outer_mask = np.zeros(shape, dtype=bool)
        outer_mask[8:40, 8:40] = True
        outer_mask[18:30, 18:30] = False
        child_mask = np.zeros(shape, dtype=bool)
        child_mask[18:30, 18:30] = True
        parent = SemanticPart(
            part_id="eye-white",
            kind=SemanticPartKind.CLOSED_CONTOUR,
            role="feature_outline",
            design_color_id=0,
            source_color_rgb=(250, 250, 250),
            thread_index=0,
            mask=outer_mask,
            paths=(
                (
                    (8.0, 8.0),
                    (39.0, 8.0),
                    (39.0, 39.0),
                    (8.0, 39.0),
                    (8.0, 8.0),
                ),
            ),
            hole_paths=(
                (
                    (18.0, 18.0),
                    (29.0, 18.0),
                    (29.0, 29.0),
                    (18.0, 29.0),
                    (18.0, 18.0),
                ),
            ),
            subject_confidence=1.0,
        )
        child = SemanticPart(
            part_id="pupil",
            kind=SemanticPartKind.COMPACT_FILL,
            role="compact_feature",
            design_color_id=1,
            source_color_rgb=(20, 20, 20),
            thread_index=1,
            mask=child_mask,
            paths=parent.hole_paths,
            parent_id=parent.part_id,
            z_order=31,
            subject_confidence=1.0,
        )
        image = np.full((*shape, 3), (240, 140, 120), dtype=np.uint8)
        design_map = np.zeros(shape, dtype=np.int32)
        design_map[child_mask] = 1
        threads = [
            ThreadColor(name="White", color_rgb=(250, 250, 250)),
            ThreadColor(name="Black", color_rgb=(20, 20, 20)),
        ]
        recognition = self._recognition_result(
            image,
            design_map,
            design_map != 0,
            (parent, child),
            threads,
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            threads,
            image,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )
        parent_region = next(
            region
            for layer in layers
            for region in layer.regions
            if region.semantic_part_id == parent.part_id
        )

        self.assertEqual(len(parent_region.guide_paths_px), 1)

    def test_cross_semantic_outline_keeps_same_color_underpaint(self):
        shape = (40, 56)
        semantic = np.zeros(shape, dtype=np.uint8)
        cv2.rectangle(semantic, (18, 12), (37, 27), 255, 2)
        fill = np.full(shape, 255, dtype=np.uint8)
        fill[semantic > 0] = 0
        layers = [
            Layer(
                regions=[
                    Region(
                        mask=fill,
                        stitch_settings=StitchSettings(fill_mode="cross_stitch"),
                    ),
                    Region(
                        mask=semantic,
                        semantic_part_id="closed-outline",
                        semantic_kind=SemanticPartKind.CLOSED_CONTOUR.value,
                        stitch_settings=StitchSettings(fill_mode="run"),
                    ),
                ],
            )
        ]

        ImageEngine._underpaint_same_layer_semantic_details(layers)

        self.assertTrue(np.all(layers[0].regions[0].mask[semantic > 0] > 0))

    def test_same_color_semantic_line_keeps_fill_underneath(self):
        shape = (48, 72)
        source_rgb = (242, 132, 116)
        image = np.full((*shape, 3), source_rgb, dtype=np.uint8)
        design_map = np.zeros(shape, dtype=np.int32)
        line_mask = np.zeros(shape, dtype=bool)
        line_mask[23:25, 12:60] = True
        part = SemanticPart(
            part_id="d0-line",
            kind=SemanticPartKind.OPEN_LINE,
            role="line_detail",
            design_color_id=0,
            source_color_rgb=source_rgb,
            thread_index=0,
            mask=line_mask,
            paths=(((12.0, 24.0), (59.0, 24.0)),),
            stitch_intent="continuous_run",
        )
        thread = ThreadColor(name="Coral", color_rgb=source_rgb)
        metrics = RecognitionMetrics(1.0, 1.0, 1.0, 1.0)
        recognition = RecognitionResult(
            design_map=design_map,
            design_colors=[DesignColor(0, source_rgb, design_map.size, 0, 0.0)],
            reconstructed_rgb=image.copy(),
            detail_mask=line_mask,
            detail_design_ids=(0,),
            metrics=metrics,
            subject_mask=np.ones(shape, dtype=bool),
            thread_map=design_map.copy(),
            thread_reconstructed_rgb=image.copy(),
            thread_metrics=metrics,
            subject_metrics=metrics,
            semantic_parts=(part,),
        )

        layers = ImageEngine.build_layers_from_recognition(
            recognition,
            [thread],
            image,
            generation_mode="photo_stitch",
            quant_settings=QuantizationSettings(include_background=True),
        )

        run_mask = np.zeros(shape, dtype=bool)
        fill_mask = np.zeros(shape, dtype=bool)
        for layer in layers:
            for region in layer.regions:
                if region.stitch_settings.fill_mode in ("run", "satin"):
                    run_mask |= region.mask > 0
                elif region.stitch_settings.fill_mode == "scanline":
                    fill_mask |= region.mask > 0
        self.assertTrue(np.any(run_mask))
        self.assertTrue(np.all(fill_mask[run_mask]))

    def test_semantic_underpaint_stays_inside_its_own_color_layer(self):
        shape = (32, 48)
        detail_mask = np.zeros(shape, dtype=np.uint8)
        detail_mask[15:17, 12:36] = 255
        own_fill = np.zeros(shape, dtype=np.uint8)
        own_fill[8:24, 4:44] = 255
        own_fill[detail_mask > 0] = 0
        other_fill = np.zeros(shape, dtype=np.uint8)
        other_fill[8:24, 24:44] = 255
        other_before = other_fill.copy()
        layers = [
            Layer(
                thread_color_rgb=(220, 80, 60),
                regions=[
                    Region(
                        mask=own_fill,
                        stitch_settings=StitchSettings(fill_mode="scanline"),
                    ),
                    Region(
                        mask=detail_mask,
                        semantic_part_id="same-color-line",
                        semantic_kind=SemanticPartKind.OPEN_LINE.value,
                        stitch_settings=StitchSettings(fill_mode="run"),
                    ),
                ],
            ),
            Layer(
                thread_color_rgb=(40, 80, 220),
                regions=[
                    Region(
                        mask=other_fill,
                        stitch_settings=StitchSettings(fill_mode="scanline"),
                    ),
                ],
            ),
        ]

        ImageEngine._underpaint_same_layer_semantic_details(layers)

        self.assertTrue(np.all(layers[0].regions[0].mask[detail_mask > 0] > 0))
        self.assertTrue(np.array_equal(layers[1].regions[0].mask, other_before))

    def test_semantic_open_lines_choose_reinforced_run_or_satin_by_width(self):
        hairline = np.zeros((48, 72), dtype=np.uint8)
        hairline[24, 10:62] = 255
        narrow_band = np.zeros((48, 72), dtype=np.uint8)
        narrow_band[22:26, 10:62] = 255

        hairline_settings = ImageEngine._semantic_stitch_settings(
            SemanticPartKind.OPEN_LINE,
            hairline,
            "photo_stitch",
        )
        narrow_band_settings = ImageEngine._semantic_stitch_settings(
            SemanticPartKind.OPEN_LINE,
            narrow_band,
            "photo_stitch",
        )

        self.assertEqual(hairline_settings.fill_mode, "run")
        self.assertEqual(hairline_settings.run_passes, 3)
        self.assertEqual(narrow_band_settings.fill_mode, "satin")

    def test_open_line_uses_recognition_guide_instead_of_reskeletonizing_mask(self):
        mask = np.zeros((56, 72), dtype=np.uint8)
        cv2.line(mask, (8, 42), (38, 42), 255, 3, lineType=cv2.LINE_8)
        cv2.line(mask, (38, 42), (38, 12), 255, 3, lineType=cv2.LINE_8)
        guide = [[(8.0, 42.0), (38.0, 42.0), (38.0, 12.0)]]
        region = Region(
            mask=mask,
            semantic_kind=SemanticPartKind.OPEN_LINE.value,
            guide_paths_px=guide,
            stitch_settings=StitchSettings(
                fill_mode="run",
                stitch_length_mm=1.0,
                run_passes=1,
                run_corner_mode="preserve",
            ),
        )

        engine = StitchEngine(px_per_mm=4.0)
        paths = engine.generate_region_paths(region)
        scale = 10.0 / engine.px_per_mm
        path_px = np.asarray(paths[0], dtype=np.float64) / scale

        self.assertEqual(len(paths), 1)
        self.assertLessEqual(
            min(np.linalg.norm(point - (38.0, 42.0)) for point in path_px),
            0.25,
        )
        self.assertLessEqual(np.linalg.norm(path_px[0] - (8.0, 42.0)), 0.25)
        self.assertLessEqual(np.linalg.norm(path_px[-1] - (38.0, 12.0)), 0.25)

    def test_closed_contour_uses_recognition_guide_and_preserves_pointed_corners(self):
        mask = np.zeros((72, 88), dtype=np.uint8)
        cv2.ellipse(mask, (44, 36), (24, 17), 0, 0, 360, 255, 7)
        guide = [[
            (18.0, 36.0),
            (31.0, 19.0),
            (44.0, 13.0),
            (57.0, 19.0),
            (72.0, 36.0),
            (57.0, 53.0),
            (44.0, 59.0),
            (31.0, 53.0),
            (18.0, 36.0),
        ]]
        region = Region(
            mask=mask,
            semantic_part_id="pointed-mouth",
            semantic_kind=SemanticPartKind.CLOSED_CONTOUR.value,
            guide_paths_px=guide,
            guide_paths_closed=[True],
            guide_corner_indices=[[0, 2, 4, 6]],
            stitch_settings=StitchSettings(
                fill_mode="run",
                stitch_length_mm=0.8,
                run_passes=1,
                run_trace_contour=True,
                run_centerline_contour=True,
                run_corner_mode="adaptive",
            ),
        )

        engine = StitchEngine(px_per_mm=4.0)
        paths = engine.generate_region_paths(region)
        scale = 10.0 / engine.px_per_mm
        path_px = np.asarray(paths[0], dtype=np.float64) / scale

        self.assertEqual(len(paths), 1)
        self.assertLessEqual(
            min(np.linalg.norm(point - (44.0, 13.0)) for point in path_px),
            0.25,
        )
        self.assertLessEqual(
            min(np.linalg.norm(point - (72.0, 36.0)) for point in path_px),
            0.25,
        )
        self.assertLessEqual(np.linalg.norm(path_px[0] - path_px[-1]), 0.01)

    def test_satin_halo_cleanup_does_not_erase_semantic_closed_contour(self):
        shape = (48, 64)
        satin_mask = np.zeros(shape, dtype=np.uint8)
        satin_mask[20:28, 12:52] = 255
        contour_mask = np.zeros(shape, dtype=np.uint8)
        contour_mask[19, 12:52] = 255
        semantic = Region(
            mask=contour_mask.copy(),
            semantic_part_id="eye-outline",
            semantic_kind=SemanticPartKind.CLOSED_CONTOUR.value,
            stitch_settings=StitchSettings(fill_mode="run", run_passes=1),
        )
        layers = [
            Layer(
                thread_color_rgb=(20, 20, 20),
                regions=[semantic],
            ),
            Layer(
                thread_color_rgb=(220, 80, 60),
                regions=[
                    Region(
                        mask=satin_mask,
                        stitch_settings=StitchSettings(fill_mode="satin"),
                    )
                ],
            ),
        ]

        ImageEngine._suppress_satin_border_halos(layers)

        self.assertEqual(len(layers[0].regions), 1)
        self.assertTrue(np.array_equal(layers[0].regions[0].mask, contour_mask))

    def test_confirmed_tiny_highlight_survives_generic_stitch_noise_filter(self):
        mask = np.zeros((24, 24), dtype=np.uint8)
        mask[10:12, 13:15] = 255
        region = Region(
            mask=mask,
            semantic_part_id="pupil-highlight",
            semantic_kind=SemanticPartKind.PROTECTED_HIGHLIGHT.value,
            stitch_settings=StitchSettings(
                fill_mode="scanline",
                stitch_length_mm=0.35,
                row_spacing_mm=0.12,
                density=1.6,
                underlay=False,
            ),
        )

        paths = StitchEngine(px_per_mm=4.0).generate_region_paths(region)

        self.assertTrue(paths)
        self.assertTrue(any(len(path) >= 2 for path in paths))

    def test_micro_detail_fallback_stays_on_supported_pixels(self):
        mask = np.zeros((18, 18), dtype=np.uint8)
        cv2.rectangle(mask, (5, 5), (12, 12), 255, 1)
        engine = StitchEngine(px_per_mm=4.0)

        path = engine._generate_micro_detail_path(mask)

        self.assertGreaterEqual(len(path), 4)
        for start, end in zip(path, path[1:]):
            distance = max(1, int(np.ceil(np.hypot(
                end[0] - start[0],
                end[1] - start[1],
            ) * 2)))
            for ratio in np.linspace(0.0, 1.0, distance + 1):
                x = int(round(start[0] + (end[0] - start[0]) * ratio))
                y = int(round(start[1] + (end[1] - start[1]) * ratio))
                self.assertGreater(mask[y, x], 0)

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
