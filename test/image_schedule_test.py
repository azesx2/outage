"""Compare real image OCR against independently captured official API text."""
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('image_schedule', ROOT / 'scripts/image_schedule.py')
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


class ImageScheduleTest(unittest.TestCase):
    def card_texts(self):
        groups = [f'{group}.{subgroup}' for group in range(1, 7) for subgroup in (1, 2)]
        return ['17.10.2026', 'Інформація станом на 18:56 17.10.2026'] + [
            f'{group}\nЕлектроенергія є\n' for group in groups]

    def test_half_hours_multiple_intervals_and_midnight(self):
        texts = self.card_texts()
        texts[2] = '1.1\nЕлектроенергії\nнемає\nз 00:00 по 02:30\nз 20:30 по 24:00\n'
        with patch.object(parser, 'ocr', side_effect=texts):
            result = parser.extract(ROOT / 'test/fixtures/source/current-image-2026-10-17.png')
        self.assertIn('з 00:00 до 02:30, з 20:30 до 24:00.', result)
        self.assertIn('Група 6.2. Електроенергія є.', result)

    def test_partial_interval_cannot_silently_drop_an_outage(self):
        texts = self.card_texts()
        texts[2] = '1.1\nЕлектроенергії\nнемає\nз 00:00 по 02:30\nз 20:30 по ??\n'
        with patch.object(parser, 'ocr', side_effect=texts):
            with self.assertRaises(ValueError):
                parser.extract(ROOT / 'test/fixtures/source/current-image-2026-10-17.png')

    def test_official_image_matches_twelve_groups_and_timestamps(self):
        actual = parser.extract(ROOT / 'test/fixtures/source/current-image-2026-10-17.png')
        fixture = json.loads((ROOT / 'test/fixtures/source/normal-live-2026-10-17.json').read_text())
        expected = re.sub(r'<[^>]+>|\s+', '', fixture['responses']['today']['rawHtml'])
        self.assertEqual(re.sub(r'<[^>]+>|\s+', '', actual), expected)

    def test_unrecognized_visualization_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'blank.png'
            Image.new('RGB', (2600, 878), 'white').save(path)
            with self.assertRaisesRegex(ValueError, 'Expected twelve cards'):
                parser.extract(path)


if __name__ == '__main__':
    unittest.main()
