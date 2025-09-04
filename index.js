const express = require('express');
const morgan = require("morgan");
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// إنشاء مجلدات إذا لم تكن موجودة
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('compressed')) fs.mkdirSync('compressed');
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

app.use(morgan("dev")); 
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// استضافة الملفات المضغوطة مباشرة
app.use('/compressed', express.static(path.join(__dirname, 'compressed')));

function logRequest(req) {
    const timestamp = new Date().toISOString();
    const logData = {
        time: timestamp,
        body: req.body,
        files: req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname, size: f.size })),
        url: req.originalUrl,
        method: req.method
    };
    fs.appendFileSync('logs/requests.txt', JSON.stringify(logData, null, 2) + "\n----------------------\n", 'utf8');
}

app.post('/compress', upload.any(), async (req, res) => {
    logRequest(req);

    const files = req.files.filter(f => f.fieldname.startsWith('images'));
    if (!files || files.length === 0) return res.status(400).json({ error: 'No images uploaded' });

    const qualityJPEG = parseInt(req.body.quality_jpeg) || 75;
    const qualityPNG = parseInt(req.body.quality_png) || 80;
    const qualityWebP = parseInt(req.body.quality_webp) || 75;
    const qualityAVIF = parseInt(req.body.quality_avif) || 50;

    const resizeWidth = req.body.resize_width ? parseInt(req.body.resize_width) : null;
    const resizeHeight = req.body.resize_height ? parseInt(req.body.resize_height) : null;
    const crop = req.body.crop === '1' || req.body.crop === 1;
    const keepTransparency = req.body.keep_transparency === '1' || req.body.keep_transparency === 1;

    let convertTo = [];
    if (req.body.convert_to) {
        if (Array.isArray(req.body.convert_to)) convertTo = req.body.convert_to;
        else convertTo = req.body.convert_to.toString().split(',').map(v => v.trim());
    }

    const results = [];

    for (const file of files) {
        const inputPath = file.path;
        const originalName = file.originalname;
        const originalSize = file.size;
        const ext = path.extname(originalName).toLowerCase();

        try {
            let image = sharp(inputPath);

            if (resizeWidth || resizeHeight) {
                image = image.resize({
                    width: resizeWidth,
                    height: resizeHeight,
                    fit: crop ? 'cover' : 'inside'
                });
            }

            if (!keepTransparency) {
                image = image.flatten({ background: { r: 255, g: 255, b: 255 } });
            }

            const baseName = `${Date.now()}_${path.parse(originalName).name}`;
            let compressedFormats = [];

            if (convertTo.length > 0) {
                for (let format of convertTo) {
                    const fmt = format.toLowerCase();
                    const outPath = path.join('compressed', `${baseName}.${fmt}`);

                    if (fmt === 'jpeg' || fmt === 'jpg') await image.jpeg({ quality: qualityJPEG }).toFile(outPath);
                    else if (fmt === 'png') await image.png({ quality: qualityPNG, compressionLevel: 9 }).toFile(outPath);
                    else if (fmt === 'webp') await image.webp({ quality: qualityWebP }).toFile(outPath);
                    else if (fmt === 'avif') await image.avif({ quality: qualityAVIF }).toFile(outPath);

                    const compressedSize = fs.statSync(outPath).size;

                    compressedFormats.push({
                        format: fmt,
                        compressed_size: compressedSize,
                        ratio: ((1 - compressedSize / originalSize) * 100).toFixed(2) + '%',
                        download_url: `${req.protocol}://${req.get('host')}/compressed/${path.basename(outPath)}`
                    });
                }
            } else {
                const outPath = path.join('compressed', `${baseName}${ext}`);
                if (ext === '.png') await image.png({ quality: qualityPNG }).toFile(outPath);
                else await image.jpeg({ quality: qualityJPEG }).toFile(outPath);

                const compressedSize = fs.statSync(outPath).size;

                compressedFormats.push({
                    format: ext.replace('.', ''),
                    compressed_size: compressedSize,
                    ratio: ((1 - compressedSize / originalSize) * 100).toFixed(2) + '%',
                    download_url: `${req.protocol}://${req.get('host')}/compressed/${path.basename(outPath)}`
                });
            }

            fs.unlinkSync(inputPath); // حذف الصورة الأصلية المؤقتة

            results.push({
                original_name: originalName,
                original_size: originalSize,
                outputs: compressedFormats
            });

        } catch (err) {
            results.push({
                original_name: originalName,
                error: err.message
            });
        }
    }

    res.json(results);
});

app.listen(3000, () => console.log('Server running on http://0.0.0.0:3000'));
