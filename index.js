const express = require('express');
const morgan = require("morgan");
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// إنشاء مجلدات
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('compressed')) fs.mkdirSync('compressed');
if (!fs.existsSync('logs')) fs.mkdirSync('logs'); // مجلد للسجلات

app.use(morgan("dev")); 
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function logRequest(req) {
    const timestamp = new Date().toISOString();
    const logData = {
        time: timestamp,
        body: req.body,
        files: req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname, size: f.size })),
        url: req.originalUrl,
        method: req.method
    };
    const logText = JSON.stringify(logData, null, 2) + "\n----------------------\n";
    fs.appendFileSync('logs/requests.txt', logText, 'utf8');
}

app.post('/compress', upload.any(), async (req, res) => {
    logRequest(req); // تسجيل البيانات في ملف قبل المعالجة

    const files = req.files.filter(f => f.fieldname.startsWith('images'));
    if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No images uploaded' });
    }

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

            const outputPath = `compressed/${Date.now()}_${originalName}`;
            let compressedFormats = [];

            if (convertTo.length > 0) {
                for (let format of convertTo) {
                    let fmt = format.toLowerCase();
                    let outPath = `${outputPath}.${fmt}`;
                    
                    if (fmt === 'jpeg' || fmt === 'jpg') await image.jpeg({ quality: qualityJPEG }).toFile(outPath);
                    else if (fmt === 'png') await image.png({ quality: qualityPNG, compressionLevel: 9 }).toFile(outPath);
                    else if (fmt === 'webp') await image.webp({ quality: qualityWebP }).toFile(outPath);
                    else if (fmt === 'avif') await image.avif({ quality: qualityAVIF }).toFile(outPath);

                    const compressedSize = fs.statSync(outPath).size;
                    const compressedBuffer = fs.readFileSync(outPath);

                    compressedFormats.push({
                        format: fmt,
                        compressed_size: compressedSize,
                        ratio: ((1 - compressedSize / originalSize) * 100).toFixed(2) + '%',
                        compressed_file: compressedBuffer.toString('base64')
                    });

                    fs.unlinkSync(outPath);
                }
            } else {
                if (ext === '.png') await image.png({ quality: qualityPNG }).toFile(outputPath);
                else await image.jpeg({ quality: qualityJPEG }).toFile(outputPath);

                const compressedSize = fs.statSync(outputPath).size;
                const compressedBuffer = fs.readFileSync(outputPath);

                compressedFormats.push({
                    format: ext.replace('.', ''),
                    compressed_size: compressedSize,
                    ratio: ((1 - compressedSize / originalSize) * 100).toFixed(2) + '%',
                    compressed_file: compressedBuffer.toString('base64')
                });

                fs.unlinkSync(outputPath);
            }

            fs.unlinkSync(inputPath); 

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

app.listen(3000, () => {
    console.log('Server running on http://0.0.0.0:3000');
});
