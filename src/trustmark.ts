// Copyright 2023 Adobe
// All Rights Reserved.

// NOTICE: Adobe permits you to use, modify, and distribute this file in
// accordance with the terms of the Adobe license agreement accompanying
// it.

// Copyright (C) 2024 Bertrand Gondouin
// Additional changes made by Bertrand Gondouin to port the original
// MIT-licensed Python code to TypeScript are licensed under GPLv3.

import { readFileSync, writeFile, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import * as ort from 'onnxruntime-node';
import * as tf from '@tensorflow/tfjs-node';
import { DataLayer, getSchemaCapacity, getSchemaVersion } from './datalayer';
import modelsJson from './ONNX_HUB_MANIFEST.json';

// Node.js, path where models will be saved.
const MODELS_PATH = 'models/';

// Center crop treshold.
const ASPECT_RATIO_LIM = 2.0;

let IS_BROWSER = false;
let IS_NODE = false;

// Detect the environment
if (typeof window === 'undefined') {
  IS_NODE = true;
} else {
  IS_BROWSER = true;
}

const VERBOSE = true;

/**
 * Class representing the TrustMark watermark.
 * This class utilizes ECC (Error Correction Codes) and ONNX models for encoding and decoding.
 */
export class TrustMark {
  /** * Static encoding mapping for different BCH modes. */
  static encoding = {
    undefined: -1,
    BCH_SUPER: 0,
    BCH_3: 3,
    BCH_4: 2,
    BCH_5: 1,
  };

  use_ecc: boolean;
  secret_len: number;
  ecc: DataLayer;
  decoder_session: any;
  encoder_session: any;
  preprocess_session: any;

  /**
   * Constructs a new TrustMark instance.
   * @param {boolean} [use_ecc=true] - use BCH error correction on the payload, reducing payload size (default)
   * @param {number} [secret_len=100] - The length of the secret.
   * @param {number} [encoding_mode=TrustMark.encoding.BCH_4] - The data schema encoding mode to use.
   */

  constructor(use_ecc = true, secret_len = 100, encoding_mode: number = TrustMark.encoding.BCH_4) {
    this.use_ecc = use_ecc;
    this.secret_len = secret_len;
    this.ecc = new DataLayer(secret_len, VERBOSE, encoding_mode);
  }

  /**
   * Decodes the watermark of an image from a given URL.
   *
   * @param image_url The URL of the image to decode.
   * @returns A promise that resolves to the decoded watermnark data.
   */
  async decode(image_url: string): Promise<any> {
    tf.engine().startScope();

    // Load and process the image
    const stego_image = await this.loadImage(image_url);
    await sleep(0);
    tf.engine().endScope();

    // Prepare feeds using the model input names as keys
    const input_feeds = { image: stego_image.onnx };

    // Feed input and run the model
    const start_time = new Date();
    const model_output: any = await this.decoder_session.run(input_feeds);
    const time_elapsed = new Date().getTime() - start_time.getTime();
    tsLog(`Prediction: ${time_elapsed}ms`);
    await sleep(0);

    // Decode the prediction
    const output_data = model_output.output.cpuData;

    // Convert prediction values to binary array
    const binary_array: number[] = output_data.map((value: number) => (value >= 0 ? 1 : 0));

    // Determine the data schema and extract data and error correction codes
    const schema: number = getSchemaVersion(binary_array);
    let data_bits: number = getSchemaCapacity(schema);
    let data: number[] = binary_array.slice(0, data_bits);
    let ecc: number[] = binary_array.slice(data_bits, 96);

    // Decode the data using the appropriate BCH decoder
    let decoded_data: any = this.ecc.bch_decoders[schema].decode(data, ecc);
    decoded_data.schema = schema;

    // Attempt to recover from version bit corruption by trying other schemas modes
    if (!decoded_data.valid) {
      for (let alt_schema = 0; alt_schema < 3; alt_schema++) {
        if (alt_schema === schema) continue;
        data_bits = getSchemaCapacity(alt_schema);
        data = binary_array.slice(0, data_bits);
        ecc = binary_array.slice(data_bits, 96);
        decoded_data = this.ecc.bch_decoders[alt_schema].decode(data, ecc);
        decoded_data.schema = alt_schema;
        if (decoded_data.valid) {
          break;
        }
      }
    }
    decoded_data.raw = binary_array;
    return decoded_data;
  }

  /**
   * Encodes a secret into an image and returns the stego image and the residual image.
   *
   * @param {string} image_url The cover image data.
   * @param {string} string_secret The secret string to encode.
   * @param {number} wm_strength The watermark strength. Default is 0.4.
   * @param {boolean} maculate Whether to overwrite an existing watermark with random values. Default is false.
   * @param {string} output The output format. Default is 'bytes'.
   * @returns A promise that resolves with the encoded data or rejects with an error.
   */
  async encode(
    image_url: string,
    string_secret: string,
    wm_strength = 0.4,
    maculate = false,
    output = 'bytes',
  ): Promise<any> {
    tf.engine().startScope();

    // Load and process the image as a ONNX tensor
    const cover_image = await this.loadImage(image_url); // float32[1,3,256,256]

    let mode: string;
    let secret = new Float32Array(100);

    if (maculate === true) {
      // Overwrite an existing watermark with random values and no schema
      mode = 'binary';
      secret.set(
        Float32Array.from({ length: 96 }, () => Math.round(Math.random())),
        0,
      );
      secret.set([0, 0, 0, 0], 96);
    } else {
      // Detect mode based on string_secret
      const binary_count = string_secret.match(/[01]/g);
      if (binary_count && binary_count.length == string_secret.length) {
        mode = 'binary';
      } else {
        mode = 'text';
      }

      // Encode the secret based on mode and ECC usage
      if (!this.use_ecc) {
        if (mode === 'binary') {
          secret = new Float32Array(Array.from(string_secret).map(Number));
        } else {
          secret = this.ecc.encodeAscii(string_secret); // bytearray
          secret = new Float32Array(Array.from(secret).map(Number));
        }
      } else {
        if (mode === 'binary') {
          secret = this.ecc.encodeBinary(string_secret);
        } else {
          secret = this.ecc.encodeText(string_secret);
        }
      }
    }

    cover_image.onnx_secret = new ort.Tensor('float32', secret, [1, 100]); // float32[1,100]

    // Prepare feeds using model input names as keys
    const input_feeds = { 'onnx::Concat_0': cover_image.onnx, 'onnx::Gemm_1': cover_image.onnx_secret };

    // Feed inputs and run the model
    let start_time = new Date();
    const model_output: any = await this.encoder_session.run(input_feeds); // float32[1,3,256,256]
    let time_elapsed = new Date().getTime() - start_time.getTime();
    tsLog(`Inference: ${time_elapsed}ms`);
    await sleep(0);

    // Create residual sensor
    start_time = new Date();

    const tf_cover = tf.tensor(cover_image.onnx.cpuData, [1, 3, 256, 256]); // [1, 3, 256, 256]
    const tf_stego = tf.tensor(model_output.image.cpuData, [1, 3, 256, 256]); // [1, 3, 256, 256]
    let tf_residual: tf.Tensor3D = tf.clipByValue(tf_stego, -1, 1).sub(tf_cover).squeeze().transpose([1, 2, 0]); //[256, 256, 3]

    tf_cover.dispose();
    tf_stego.dispose();

    if ((IS_NODE && VERBOSE) || IS_BROWSER) {
      // Residual display
      const residual_display = tf_residual.mul(10.0).clipByValue(0, 1);

      if (IS_NODE) {
        if (output == 'png') {
          cover_image.residual = await tf.node.encodePng(residual_display.mul(255.0));
        } else {
          cover_image.residual = await tf.browser.toPixels(residual_display as tf.Tensor3D);
        }
      } else {
        cover_image.residual = await tf.browser.toPixels(residual_display as tf.Tensor3D);
      }
      residual_display.dispose();
    }

    // Resize tf_residual
    tf_residual = tf.image.resizeBilinear(tf_residual, [cover_image.crop_height, cover_image.crop_width]); // [h, w, 3]

    time_elapsed = new Date().getTime() - start_time.getTime();
    tsLog(`Residual Interpolation: ${time_elapsed}ms`);
    await sleep(0);

    // Merge tf_residual with the cover image
    start_time = new Date();
    let tf_merge = tf.clipByValue(tf.add(tf_residual.mul(wm_strength), cover_image.tf_crop), 0, 1);

    if (cover_image.aspect_ratio > 2) {
      if (cover_image.orientation == 'landscape') {
        const axe_length = Math.floor((cover_image.width - cover_image.crop_axe) / 2);
        const part_a = cover_image.tf_source.slice([0, 0, 0], [cover_image.crop_axe, axe_length, 3]);
        const part_b = cover_image.tf_source.slice(
          [0, axe_length + cover_image.crop_axe, 0],
          [cover_image.crop_axe, cover_image.width - axe_length - cover_image.crop_axe, 3],
        );
        tf_merge = tf.concat([part_a, tf_merge, part_b], 1);
      }

      if (cover_image.orientation == 'portrait') {
        const axe_length = Math.floor((cover_image.height - cover_image.crop_axe) / 2);
        const part_a = cover_image.tf_source.slice([0, 0, 0], [axe_length, cover_image.crop_axe, 3]);
        const part_b = cover_image.tf_source.slice(
          [axe_length + cover_image.crop_axe, 0, 0],
          [cover_image.height - axe_length - cover_image.crop_axe, cover_image.crop_axe, 3],
        );
        tf_merge = tf.concat([part_a, tf_merge, part_b], 0);
      }
    }

    cover_image.tf_crop.dispose();
    tf_residual.dispose();
    time_elapsed = new Date().getTime() - start_time.getTime();
    tsLog(`Compositing: ${time_elapsed}ms`);
    await sleep(0);

    start_time = new Date();

    if (IS_NODE) {
      if (output == 'png') {
        cover_image.stego = await tf.node.encodePng(tf_merge.mul(255.0));
      } else {
        cover_image.stego = await tf.browser.toPixels(tf_merge as tf.Tensor3D);
      }
    } else {
      cover_image.stego = await tf.browser.toPixels(tf_merge as tf.Tensor3D);
    }
    time_elapsed = new Date().getTime() - start_time.getTime();
    tsLog(`Encoding: ${time_elapsed}ms`);
    await sleep(0);

    tf.engine().endScope();

    return {
      stego: cover_image.stego,
      residual: cover_image.residual ? cover_image.residual : new Uint8Array(),
      height: cover_image.height,
      width: cover_image.width,
    };
  }

  /**
   * Processes an image and returns the processed data.
   *
   * @param image The input image data.
   * @returns A promise that resolves with the processed image data or rejects with an error.
   */
  async processImage(image: any): Promise<any> {
    const start_time = new Date();
    image.width = image.tf_source.shape[2];
    image.height = image.tf_source.shape[1];

    // get the aspect ratio
    if (image.width > image.height) {
      image.orientation = 'landscape';
      image.aspect_ratio = image.width / image.height;
    } else {
      image.orientation = 'portrait';
      image.aspect_ratio = image.height / image.width;
    }

    // Crop the image in the center if aspect ratio is greater than ASPECT_RATIO_LIM
    if (image.aspect_ratio > ASPECT_RATIO_LIM) {
      const size = Math.min(image.width, image.height);
      const left = (image.width - size) / 2;
      const top = (image.height - size) / 2;

      image.tf_crop = tf.image.cropAndResize(
        image.tf_source,
        [[top / image.height, left / image.width, (top + size) / image.height, (left + size) / image.width]],
        [0],
        [size, size],
        'nearest',
      );
      image.crop_axe = image.crop_width = image.crop_height = size;
    } else {
      image.tf_crop = image.tf_source;
      image.crop_width = image.width;
      image.crop_height = image.height;
      //input.tf_source.dispose;
    }
    image.tf_source = image.tf_source.squeeze();

    // Convert tensor to a TypedArray
    image.tf_crop = image.tf_crop.transpose([0, 3, 1, 2]);
    const data = image.tf_crop.dataSync();

    // Convert the TypedArray to an ONNX Runtime tensor
    const onnxTensor = new ort.Tensor('float32', data, image.tf_crop.shape);
    image.tf_crop = image.tf_crop.transpose([0, 2, 3, 1]);
    image.tf_crop = image.tf_crop.squeeze();

    // Run preprocessing session
    image.onnx = (await this.preprocess_session.run({ input: onnxTensor })).output;
    await sleep(0);
    const time_elapsed = new Date().getTime() - start_time.getTime();
    tsLog(`Processing: ${image.width}x${image.height}: ${time_elapsed}ms`);
    return image;
  }

  /**
   * Loads an image from a given URL and processes it.
   *
   * @param image_url The URL of the image to load.
   * @returns A promise that resolves with the processed image data or rejects with an error.
   */
  async loadImage(image_url: string): Promise<any> {
    return new Promise(async (resolve) => {
      const start_time = new Date();
      const image: any = { url: image_url };

      if (IS_NODE) {
        // Load the image from the filesystem in a Node.js environment
        const image_buffer = readFileSync(image.url);
        image.tf_source = tf.node.decodeImage(image_buffer).expandDims(0).div(255.0);
      } else {
        // Load the image from a URL in a browser environment
        const img: HTMLImageElement = new Image();
        img.onload = async () => {
          image.tf_source = tf.browser.fromPixels(img).expandDims(0).div(255.0); // [h, w, 3]
          const time_elapsed = new Date().getTime() - start_time.getTime();
          tsLog(`Loading: ${time_elapsed}ms`);
          resolve(await this.processImage(image));
        };
        img.src = image.url;
      }

      if (IS_NODE) {
        const time_elapsed = new Date().getTime() - start_time.getTime();
        tsLog(`Loading: ${time_elapsed}ms`);
        resolve(await this.processImage(image));
      }
    });
  }

  /**
   * Loads the ONNX models for preprocessing, encoding, and decoding.
   */
  async loadModels() {
    // Fetch model URLs
    const models: any = await getModels();

    // Define model URLs
    const decoder_model_url = models['decoder_Q.onnx'];
    const encoder_model_url = models['encoder_Q.onnx'];
    const session_option = { executionProviders: ['cpu'] };

    // Load preprocessing model
    this.preprocess_session = await ort.InferenceSession.create('models/preprocess.onnx').catch((error: any) => {
      throw new Error(`Error loading preprocessing ONNX model: ${error}`);
    });

    // Load decoder model
    this.decoder_session = await ort.InferenceSession.create(decoder_model_url, session_option).catch((error: any) => {
      throw new Error(`Error loading decoder ONNX model: ${error}`);
    });

    // Load encoder model
    this.encoder_session = await ort.InferenceSession.create(encoder_model_url, session_option).catch((error: any) => {
      throw new Error(`Error loading encoder ONNX model: ${error}`);
    });
  }
}

// ======================================================================
// Utils
// ======================================================================

async function getModels(): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const fetchs = [];
    const models: any = {};

    for (const model of modelsJson) {
      const model_url = model.model_remote_host + model.model_path;
      const model_path = MODELS_PATH + model.model_name;
      const model_bytes = model.metadata.model_bytes;

      if (IS_NODE) {
        // Check if the model exists
        if (existsSync(model_path)) {
          models[model.model_name] = model_path;
        } else {
          tsLog(`'${model_path}' needs to be fetched and cached from remote repository.`);
          fetchs.push(fetchModel(model_url, model_path, model.model_name, model.metadata.model_sha, model_bytes));
        }
      } else {
        await restoreFileFromCache(model.model_name)
          .then((file) => {
            models[model.model_name] = file;
          })
          .catch((e) => {
            tsLog(model.model_name + ' needs to be fetched and cached from remote repository.');
            fetchs.push(fetchModel(model_url, model_path, model.model_name, model.metadata.model_sha, model_bytes));
          });
      }
    }

    await Promise.all(fetchs)
      .then((fmodels) => {
        fmodels.forEach(function (fmodel: any) {
          models[fmodel.model_name] = fmodel.path;
        });
      })
      .catch((err: Error) => reject(err));
    resolve(models);
  });
}

async function fetchModel(
  url: string,
  file_path: string,
  model_name: string,
  checksum: string,
  model_bytes: number,
): Promise<any> {
  return new Promise(async (resolve, reject) => {
    fetch(url)
      .then((response) => {
        return response.body;
      })
      .then((body) => {
        const reader = body!.getReader();
        let charsReceived = 0;
        return new ReadableStream({
          async start(controller) {
            return pump();

            function pump(): any {
              return reader.read().then(({ done, value }) => {
                // When no more data needs to be consumed, close the stream
                if (done) {
                  controller.close();
                  return;
                }

                charsReceived += value.length;
                const progress_percentage = Math.floor((charsReceived / model_bytes) * 100);
                if (IS_NODE) {
                  process.stdout.clearLine(0);
                  process.stdout.cursorTo(0);
                  process.stdout.write(`Progress: ${drawProgressBar(progress_percentage)} of ${model_name}`);
                } else {
                  tsLog(`Loading model: ${progress_percentage}% of ${file_path}`, true);
                }
                // Enqueue the next data chunk into our target stream
                controller.enqueue(value);
                return pump();
              });
            }
          },
        });
      })
      .then((stream) => new Response(stream))
      .then((response) => response.arrayBuffer())
      .then(async (a_buffer) => {
        const file_chacksum = await sha(new Uint8Array(a_buffer));
        if (file_chacksum == checksum) {
          const model: any = {
            model_name: model_name,
            path: a_buffer,
          };

          if (IS_NODE) {
            writeFile(file_path, new Uint8Array(a_buffer), (err) => {
              if (err) {
                reject(err);
              } else {
                resolve(model);
              }
            });
          } else {
            await storeFileInCache(model_name, new Blob([a_buffer], { type: 'application/octet-stream' }));
            resolve(model);
          }
        }
      })
      .catch((err: Error) => reject(err));
  });
}

async function restoreFileFromCache(model_name: string): Promise<ArrayBuffer> {
  const modelCache = await caches.open('models');
  const response = await modelCache.match(model_name);
  if (!response) {
    throw new Error(`${model_name} not found in cache.`);
  }
  const file = await response.arrayBuffer();
  tsLog(`${model_name} found in cache.`);
  return file;
}

async function storeFileInCache(model_name: string, blob: Blob) {
  try {
    const modelCache = await caches.open('models');
    await modelCache.put(model_name, new Response(blob));
    tsLog(`${model_name} cached`);
  } catch (err: any) {
    throw new Error(err);
  }
}

// Drawing the Progress Bar Image
function drawProgressBar(progress: number) {
  const barWidth = 30;
  const filledWidth = Math.floor((progress / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const progressBar = '█'.repeat(filledWidth) + '▒'.repeat(emptyWidth);
  return `[${progressBar}] ${progress}%`;
}

function sha(content: Uint8Array) {
  if (IS_NODE) {
    return createHash('sha256').update(content).digest('hex');
  } else {
    return hash(content);
  }
}

function sleep(m: number) {
  if (IS_BROWSER) {
    return new Promise((resolve) => setTimeout(resolve, m));
  }
}

function tsLog(str: string, browser_only = false) {
  if (IS_BROWSER) {
    const payloadevt = new CustomEvent('status', { detail: str });
    window.dispatchEvent(payloadevt);
  }
  if (IS_NODE && browser_only === false && VERBOSE) {
    console.log(str);
  }
}

async function hash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((bytes) => bytes.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
