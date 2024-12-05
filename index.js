import { TrustMark } from './dist/index.js'

// ======================================================================
// Global variables
// ======================================================================


let MODE = 'Q' // TrustMark Available modes: C=compact, Q=quality, B=base
let ENCODING_TYPE = TrustMark.encoding.BCH_4
let WM_STRENGTH = 0.4;
let JPEG_QUALITY = 0.9;

// ======================================================================
// DOM Elements
// ======================================================================
let status_element = document.getElementById("status");
let result_element = document.getElementById("result");
let secret_element = document.getElementById('secret');
let image_container = document.getElementById("image_container");
let display_img = document.getElementById("display_img");
let residual_img = document.getElementById("residual_img");
let set_wm_strength_slider = document.getElementById("set_wm_strength");
let wm_strength = document.getElementById('wm_strength')
let encode_button = document.getElementById("encode_button");
let erase_button = document.getElementById("erase_button");
let fileUpload = document.getElementById("upload");
let fileDownload = document.getElementById("download");
let tooltip = document.getElementById("tooltip");
let processing_element = document.getElementById('processing');

window.addEventListener('status', (event) => {
    console.log(event.detail);
    status_element.textContent = event.detail
});

wm_strength.textContent = WM_STRENGTH

let current_image;
let tm = new TrustMark({ verbose: false, model_type: MODE, encoding_type: ENCODING_TYPE })
showSpinner()
status_element.textContent = 'Loading models...'
await tm.loadModels()
status_element.textContent = 'Trustmark initialized.'
hideSpinner()

// ======================================================================
// UI functions
// ======================================================================

encode_button.addEventListener("click", async b => {
    encode().catch(e => { console.error(e) });
});

erase_button.addEventListener("click", async b => {
    erase().catch(e => { console.error(e) });
});

set_wm_strength_slider.addEventListener("input", b => {
    WM_STRENGTH = parseInt(set_wm_strength_slider.value) / 10;
    wm_strength.textContent = WM_STRENGTH
});

image_container.addEventListener("dragover", (event) => {
    event.preventDefault();
    image_container.style.backgroundColor = "#e5e7eb";
});

image_container.addEventListener("drop", async (event) => {
    event.preventDefault()
    image_container.style.backgroundColor = "unset";
    tooltip.style.display = "none";
    if (event.dataTransfer.files.length) {
        let file = event.dataTransfer.files[0];
        if (!file) return;
        display_img.src = URL.createObjectURL(file);
        current_image = {
            url: display_img.src,
            name: parseFilename(file.name).name,
            extension: parseFilename(file.name).ext,
        }
        decode()
    }
})

fileUpload.addEventListener("change", function (b) {
    image_container.style.backgroundColor = "unset";
    fileDownload.style.display = 'none';
    tooltip.style.display = "none";
    let file = b.target.files[0];
    if (!file) return;

    display_img.src = URL.createObjectURL(file);
    current_image = {
        url: display_img.src,
        name: parseFilename(file.name).name,
        extension: parseFilename(file.name).ext,
    }
    decode().catch(e => { console.error(e) });
});

window.decode_ex = (image) => {
    display_img.src = image.src
    current_image = {
        url: image.src,
        name: image.name,
        extension: parseFilename(image.src).ext,
    }
    decode()
}

window.download = async (format) => {
    let options;
    if (format == "png") { options = { type: "image/png" } }
    if (format == "jpeg") { options = { type: "image/jpeg", quality: JPEG_QUALITY } }

    let download_link = document.createElement("a");
    download_link.style.display = "none";
    download_link.href = URL.createObjectURL(await current_image.canvas.convertToBlob(options))
    download_link.download = current_image.name + current_image.filename_append + '.' + format;
    status_element.appendChild(download_link);
    download_link.click()
}


async function decode() {

    // Clear UI
    let ctx = residual_img.getContext("2d");
    ctx.clearRect(0, 0, residual_img.width, residual_img.height);
    fileDownload.style.display = 'none';
    tooltip.style.display = "none";

    status_element.textContent = 'Analysing for watermark...';
    showSpinner()
    let result = await tm.decode(current_image.url);
    hideSpinner()
    if (result.valid) {
        result_element.textContent = '💦 Watermarked Image';
        status_element.textContent = result.binary + '\nSCHEMA:' + result.schema
            + ' BITFLIPS:' + result.bitflips + ' HEX: ' + result.hex + ' ASCII: ' + result.ascii;
    } else {

        result_element.textContent = '🖼️ Input Image'
        status_element.textContent = "No Watermark found"
    }
}

async function encode() {

    // Clear Residual
    let ctx = residual_img.getContext("2d");
    ctx.clearRect(0, 0, residual_img.width, residual_img.height);

    let string_secret = secret_element.value;
    if (!current_image) {
        return;
    }
    current_image.url_backup = display_img.src;

    // Random secret if empty
    if (!string_secret) {
        string_secret = toBinString(Array.from({ length: 68 }, () => Math.round(Math.random())));
        secret_element.value = string_secret;
    }

    status_element.textContent = 'Injecting the watermark...';
    showSpinner();
    let result = await tm.encode(current_image.url, string_secret, WM_STRENGTH);
    hideSpinner();

    // Display Residual
    let residual_data = new ImageData(result.residual, 256, 256);
    ctx.putImageData(residual_data, 0, 0);


    current_image.canvas = new OffscreenCanvas(result.width, result.height);
    current_image.canvas_ctx = current_image.canvas.getContext("2d");
    let display_data = new ImageData(result.stego, result.width, result.height);
    current_image.canvas_ctx.putImageData(display_data, 0, 0);
    display_img.src = current_image.url = URL.createObjectURL(await current_image.canvas.convertToBlob());
    status_element.textContent = 'Verifying the watermark...';

    showSpinner()
    result = await tm.decode(current_image.url);
    hideSpinner();

   
    if (result.valid) {
        if (string_secret == result.ascii || string_secret == result.binary) {
            result_element.textContent = '💦 Watermarked Image';
            status_element.textContent = result.binary + '\nSCHEMA:' + result.schema
                + ' BITFLIPS:' + result.bitflips + ' HEX: ' + result.hex + ' ASCII: ' + result.ascii;
            current_image.filename_append = "_watermarked";
            fileDownload.style.display = 'flex';
        } else {
            display_img.src = current_image.url = current_image.url_backup;
            result_element.textContent = '🖼️ Input Image';
            status_element.textContent = "Watermark secret mismatch, try to change the strength level";
        }
    } else {
        display_img.src = current_image.url = current_image.url_backup;
        result_element.textContent = '🖼️ Input Image';
        status_element.textContent = "No Watermark found, try to change the strength level";
    }
}

async function erase() {
    let ctx = residual_img.getContext("2d");
    ctx.clearRect(0, 0, residual_img.width, residual_img.height);

    current_image.url_backup = display_img.src;

    status_element.textContent = 'Erasing the watermark...'
    showSpinner()
    let result = await tm.encode(current_image.url, '', WM_STRENGTH, true);
    hideSpinner()

    // Display the residual
    let residual_data = new ImageData(result.residual, 256, 256)
    ctx.putImageData(residual_data, 0, 0);

    // Display erased watermark image
    current_image.canvas = new OffscreenCanvas(result.width, result.height)
    current_image.canvas_ctx = current_image.canvas.getContext("2d");
    let display_data = new ImageData(result.stego, result.width, result.height)
    current_image.canvas_ctx.putImageData(display_data, 0, 0);
    display_img.src = current_image.url = URL.createObjectURL(await current_image.canvas.convertToBlob())

    status_element.textContent = 'Verifying...'
    showSpinner()
    result = await tm.decode(current_image.url)
    hideSpinner()
    if (result.valid) {
        display_img.src = current_image.url = current_image.url_backup;
        result_element.textContent = '💦 Watermarked Image';
        status_element.textContent = "Watermark not erased, try to change the strength level";
    } else {
        result_element.textContent = '🖼️ Input Image';
        status_element.textContent = "Watermark erased.";
        current_image.filename_append = "_watermark_erased";
        fileDownload.style.display = 'flex';
    }

}

// ======================================================================
// Utils
// ======================================================================

function showSpinner() {
    processing_element.style.display = 'block';
}

function hideSpinner() {
    processing_element.style.display = 'none';
}

function parseFilename(filename) {
    let ext = filename.split('.').pop();
    return ({ name: filename.replace("." + ext, ''), ext: ext })
}


function toBinString(bin_array) {

    let out = ""
    for (let i = 0; i < bin_array.length; i++) {
        out += bin_array[i];
    }
    return out;
}
