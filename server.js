require("dotenv").config();
const multer = require("multer");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const File = require("./models/File");
const express = require("express");
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static("public"));
app.set("view engine", "ejs");

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const upload = multer({
  storage: multer.memoryStorage(), // use memory storage for easier S3 upload
});

mongoose.connect(process.env.DATABASE_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log("Connected to MongoDB");
}).catch((err) => {
  console.error("Failed to connect to MongoDB", err);
});

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/subscription", (req, res) => {
  res.render("subscription");
});

app.get("/aboutUs", (req, res) => {
  res.render("aboutUs");
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const uploadParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `${Date.now()}-${req.file.originalname}`,
      Body: req.file.buffer,
    };

    const parallelUploads3 = new Upload({
      client: s3Client,
      params: uploadParams,
    });

    await parallelUploads3.done();

    const fileData = {
      path: uploadParams.Key,
      originalName: req.file.originalname,
    };
    if (req.body.password) {
      fileData.password = await bcrypt.hash(req.body.password, 10);
    }

    const file = await File.create(fileData);
    res.render("index", { fileLink: `${req.headers.origin}/file/${file.id}` });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("An error occurred during the upload");
  }
});

app.route("/file/:id").get(handleDownload).post(handleDownload);

async function handleDownload(req, res) {
  try {
    const file = await File.findById(req.params.id);
    if (file.password) {
      if (!req.body.password) {
        res.render("password");
        return;
      }
      if (!(await bcrypt.compare(req.body.password, file.password))) {
        res.render("password", { error: true });
        return;
      }
    }

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: file.path,
    };
    const command = new GetObjectCommand(params);
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    file.downloadCount++;
    await file.save();

    res.redirect(url);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("An error occurred during the download");
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
