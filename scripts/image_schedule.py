#!/usr/bin/env python3
"""Read the current LOE card visualization using Pillow and Tesseract.

The current visualization contains written intervals, not colored hourly cells.
No missing card or unreadable card is interpreted as an all-clear.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image, ImageOps


def ocr(image):
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, 'crop.png')
        image = image.convert('RGB')
        image.putdata([(0, 0, 0) if g > r * 1.1 and g > b * 1.4 else (r, g, b)
                       for r, g, b in image.getdata()])
        image = image.convert('L').point(lambda value: 0 if value < 125 else 255)
        ImageOps.expand(image, border=20, fill='white').save(path)
        result = subprocess.run(
            ['tesseract', path, 'stdout', '-l', 'ukr', '--psm', '6'],
            capture_output=True, text=True, check=True, timeout=20)
        return result.stdout


def runs(values):
    result = []
    for index, present in enumerate(values + [False]):
        if present and (index == 0 or not values[index - 1]):
            start = index
        if not present and index and values[index - 1]:
            result.append((start, index))
    return result


def extract(path):
    image = Image.open(path)
    if image.width * image.height > 25_000_000:
        raise ValueError('Image exceeds pixel limit')
    if image.width < 650 or image.height > image.width * 4:
        raise ValueError('Unsupported image dimensions')
    image = image.convert('RGB')
    # Gray card backgrounds locate rows/columns without assuming a fixed image size.
    small = image.resize((650, round(image.height * 650 / image.width)))
    gray = [[max(pixel) - min(pixel) < 15 and 215 < sum(pixel) / 3 < 240
             for pixel in [small.getpixel((x, y)) for x in range(small.width)]]
            for y in range(small.height)]
    row_runs = runs([sum(row) > small.width * .55 for row in gray])
    rows = []
    for top, bottom in row_runs:
        if rows and top - rows[-1][1] < 8:
            rows[-1] = (rows[-1][0], bottom)
        else:
            rows.append((top, bottom))
    boxes = []
    scale = image.width / small.width
    for top, bottom in rows:
        if bottom - top < 20:
            continue
        middle = bottom - 4
        for left, right in runs(gray[middle]):
            if right - left > 35:
                boxes.append(tuple(round(v * scale) for v in (left, top, right, bottom)))
    if len(boxes) != 12:
        raise ValueError(f'Expected twelve cards; found {len(boxes)}')
    header = ocr(image.crop((0, 0, image.width // 2, min(b[1] for b in boxes))))
    footer = ocr(image.crop((0, max(b[3] for b in boxes), image.width, image.height)))
    date = re.search(r'\b(\d{2})\.(\d{2})\.(\d{4})\b', header)
    updated = re.search(r'(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})', footer)
    if not date or not updated:
        raise ValueError('Cannot read schedule date and publication timestamp')
    lines = [f'Графік погодинних відключень на {date[0]}',
             f'Інформація станом на {updated[0]}']
    for box in boxes:
        text = ocr(image.crop(box))
        group = re.search(r'^\s*([1-6])\s*[.,]\s*([12])\b', text)
        if not group:
            raise ValueError(f'Cannot read card group: {text!r}')
        name = f'{group[1]}.{group[2]}'
        times = re.findall(r'(?<!\d)(\d{1,2}):([0-5]\d)(?!\d)', text)
        if re.search(r'Електроенергія\s+є\b', text, re.I) and not times:
            lines.append(f'Група {name}. Електроенергія є.')
        elif re.search(r'немає', text, re.I) and times and len(times) % 2 == 0:
            periods = [f'з {a[0]}:{a[1]} до {b[0]}:{b[1]}'
                       for a, b in zip(times[::2], times[1::2])]
            # Every nonempty line below the status must be a complete time range.
            interval_lines = text.split('немає')[-1].strip().splitlines()
            for line in interval_lines:
                if line.strip() and not re.fullmatch(
                        r'\s*з\s+\d{1,2}:\d{2}\s+по\s+\d{1,2}:\d{2}[.,]?\s*', line):
                    raise ValueError(f'Unrecognized interval line: {line!r}')
            lines.append(f'Група {name}. Електроенергії немає {", ".join(periods)}.')
        else:
            raise ValueError(f'Unreadable card {name}: {text!r}')
    return '<div>' + ''.join(f'<p>{line}</p>' for line in lines) + '</div>'


if __name__ == '__main__':
    try:
        print(json.dumps({'rawHtml': extract(sys.argv[1])}, ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
