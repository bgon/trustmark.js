# TrustMark.js
Javascript implementation of TrustMark watermarking as described in [TrustMark - Universal Watermarking for Arbitrary Resolution Images](https://arxiv.org/abs/2311.18297) for encoding & decoding TrustMark watermarks in modern browsers as well as Node.js.

# Important!
TrustMark.js **is not suitable** for production environments. Handling large image files significantly increases memory allocation, which can cause browser tab crashes or memory errors in a Node.js environment.

# Usage Browser

Add the `onnxruntime-web` and `@tensorflow/tfjs` dependencies to your main HTML file:
```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@latest/dist/ort.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js"></script>
```

```javascript
import { TrustMark } from './dist/index.js';
//Instanciate Trustmark
const tm = new TrustMark()

// Load the models
await tm.load_models()
// Decode an Image
let decoded = await tm.decode("tests/fixtures/Django_Reinhardt_(Gottlieb_07301)_watermarked.jpeg");
```
Note: CPU and WebGL backends are included by default in `@tensorflow/tfjs`.

# Usage Node.js
```javascript
import { TrustMark } from './dist/index.cjs';
//Instanciate Trustmark
const tm = new TrustMark()

// Load the models
await tm.load_models()
// Decode an Image
let decoded = await tm.decode("tests/fixtures/CLIC_watermarked.jpeg");
```
[tfjs-node-gpu](https://github.com/tensorflow/tfjs/blob/master/tfjs-node/README.md) is recommended for Node.js if you need to watermark large image files.

# Models

TrustMark.js is using the Q (quality) model variant, trained to encode a payload of 100 bits. Models are fetched and cached on first use into `models` directory on Node.js, and into the [CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage) in a browser environment.

## Supported data schema modes
* `Encoding.BCH_5` - Protected payload of 61 bits (+ 35 ECC bits) - allows for 5 bit flips.
* `Encoding.BCH_4` - Protected payload of 68 bits (+ 28 ECC bits) - allows for 4 bit flips. (default)
* `Encoding.BCH_3` - Protected payload of 75 bits (+ 21 ECC bits) - allows for 3 bit flips.
* `Encoding.BCH_SUPER` - Protected payload of 40 bits (+ 56 ECC bits) - allows for 8 bit flips.

## Preprocessing model

The model `models/preprocess.onnx` is used to resize images to the format expected as input for the Trustmark models. It is mandatory to get the same inference results as the original Python implementation.

# Decode
```javascript
// Decode the watermark of an image
let decoded = await tm.decode("tests/fixtures/Django_Reinhardt_(Gottlieb_07301)_watermarked.jpeg");
/*
return:
{
bitflips, (number) - corrected bits
valid, (boolean) - validity of the decoded watermark
binary, (string) - string representation of decoded bits
hex,(string) - string representation of decoded bits as hexadecimal
ascii (string) - string representation of decoded bits as 7-bit ASCII
}
*/
```

# Encode

## Text mode
The payload is encoded as ASCII 7 bits. The 68 bits give you 9 characters.

## Binary mode
The 68 bits give you 8 bytes.

```javascript
// text mode, 0.4 strenght, no erase
await tm.encode("tests/fixtures/Django_Reinhardt_(Gottlieb_07301).jpeg", 'Marzipan', 0.4, false);

// binary mode 0.4 strenght, no erase
await tm.encode("tests/fixtures/Django_Reinhardt_(Gottlieb_07301).jpeg", '11011011110100011110010101000111000100110101010010101110101011011011', 0.4, false);

// text mode, 0.4 strenght, no erase as a png encoded file
let encoded = await tm.encode("tests/fixtures/Django_Reinhardt_(Gottlieb_07301).jpeg", 'Marzipan', 0.4, false, 'png')


/*
return:
{
stego, (Uint8ClampedArray | PNG data) - the watermaked image data
residual, (Uint8ClampedArray | PNG data) - the residual image data
width, (number) - width of the watermaked image
height,(number) - height of the watermaked image
}
*/
```
# Erase

Overwrite an existing watermark with random values.

```javascript
// erase, 0.4 strenght
await tm.encode("tests/fixtures/Django_Reinhardt_(Gottlieb_07301)_watermarked.jpeg", '', 0.4, true);

/*
return:
{
stego, (Uint8ClampedArray | PNG data) - the image data with the watermark erased.
residual, (Uint8ClampedArray | PNG data) - the residual image data
width, (number) - width of the image
height,(number) - height of the image
}
*/
```