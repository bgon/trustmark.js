"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  TrustMark: () => TrustMark
});
module.exports = __toCommonJS(src_exports);

// src/trustmark.ts
var import_node_fs = require("fs");
var import_node_crypto = require("crypto");
var ort = __toESM(require("onnxruntime-node"), 1);
var tf = __toESM(require("@tensorflow/tfjs-node"), 1);

// src/bchecc.ts
var BCH = class {
  ECCstate;
  /**
   * Initializes the ECC state with given parameters.
   * @param {number} t - Number of error correctable bits, max number of bit flips we can account for, increasing this increase the ecc length
   * @param {number} poly - The polynomial used for ECC.
   */
  constructor(t, poly) {
    let tmp = poly;
    let m = 0;
    while (tmp >> 1) {
      tmp = tmp >> 1;
      m += 1;
    }
    this.ECCstate = {
      m,
      t,
      poly
    };
    this.ECCstate.n = Math.pow(2, m) - 1;
    const words = Math.ceil(m * t / 32);
    this.ECCstate.ecc_bytes = Math.ceil(m * t / 8);
    this.ECCstate.cyclic_tab = new Array(words * 1024).fill(BigInt(0));
    this.ECCstate.syn = new Array(2 * t).fill(0);
    this.ECCstate.elp = new Array(t + 1).fill(0);
    this.ECCstate.errloc = new Array(t).fill(0);
    let x = 1;
    const k = Math.pow(2, this.deg(poly));
    if (k !== Math.pow(2, this.ECCstate.m)) {
      return;
    }
    this.ECCstate.exponents = new Array(1 + this.ECCstate.n).fill(0);
    this.ECCstate.logarithms = new Array(1 + this.ECCstate.n).fill(0);
    this.ECCstate.elp_pre = new Array(1 + this.ECCstate.m).fill(0);
    for (let i2 = 0; i2 < this.ECCstate.n; i2++) {
      this.ECCstate.exponents[i2] = x;
      this.ECCstate.logarithms[x] = i2;
      if (i2 && x === 1) {
        return;
      }
      x *= 2;
      if (x & k) {
        x ^= poly;
      }
    }
    this.ECCstate.logarithms[0] = 0;
    this.ECCstate.exponents[this.ECCstate.n] = 1;
    let n = 0;
    const g = { deg: 0, c: new Array(m * t + 1).fill(BigInt(0)) };
    const roots = new Array(this.ECCstate.n + 1).fill(0);
    const genpoly = new Array(Math.ceil(m * t + 1 / 32)).fill(BigInt(0));
    for (let i2 = 0; i2 < t; i2++) {
      let r = 2 * i2 + 1;
      for (let j = 0; j < m; j++) {
        roots[r] = 1;
        r = this.mod(this, 2 * r);
      }
    }
    g.deg = 0;
    g.c[0] = BigInt(1);
    for (let i2 = 0; i2 < this.ECCstate.n; i2++) {
      if (roots[i2]) {
        const r = this.ECCstate.exponents[i2];
        g.c[g.deg + 1] = BigInt(1);
        for (let j = g.deg; j > 0; j--) {
          g.c[j] = this.g_mul(this, g.c[j], r) ^ g.c[j - 1];
        }
        g.c[0] = this.g_mul(this, g.c[0], r);
        g.deg += 1;
      }
    }
    n = g.deg + 1;
    let i = 0;
    while (n > 0) {
      const nbits = n > 32 ? 32 : n;
      let word = BigInt(0);
      for (let j = 0; j < nbits; j++) {
        if (g.c[n - 1 - j]) {
          word |= BigInt(Math.pow(2, 31 - j));
        }
      }
      genpoly[i] = word;
      i += 1;
      n -= nbits;
    }
    this.ECCstate.ecc_bits = g.deg;
    this.buildCyclic(genpoly);
    let sum = 0;
    let aexp = 0;
    for (let i2 = 0; i2 < m; i2++) {
      for (let j = 0; j < m; j++) {
        sum ^= this.g_pow(this, i2 * Math.pow(2, j));
      }
      if (sum) {
        aexp = this.ECCstate.exponents[i2];
        break;
      }
    }
    x = 0;
    const precomp = new Array(31).fill(0);
    let remaining = m;
    while (x <= this.ECCstate.n && remaining) {
      let y = this.g_sqrt(this, x) ^ x;
      for (let i2 = 0; i2 < 2; i2++) {
        const r = this.g_log(this, y);
        if (y && r < m && !precomp[r]) {
          this.ECCstate.elp_pre[r] = x;
          precomp[r] = 1;
          remaining -= 1;
          break;
        }
        y ^= aexp;
      }
      x += 1;
    }
  }
  /**
   * Encodes the data and generates ECC bytes.
   * @param {number[]} data - The input data array.
   * @returns {Uint8Array} - The generated ECC bytes.
   */
  encode(data) {
    let bigIntData = this.convertAllBitsToBigInts(data, 8);
    const datalen = bigIntData.length;
    const l = this.ceilop(this.ECCstate.m * this.ECCstate.t, 32) - 1;
    let ecc = new Array(this.getEccBytes()).fill(0);
    const ecc_max_words = this.ceilop(31 * 64, 32);
    const r = new Array(ecc_max_words).fill(BigInt(0));
    const tab0idx = 0;
    const tab1idx = tab0idx + 256 * (l + 1);
    const tab2idx = tab1idx + 256 * (l + 1);
    const tab3idx = tab2idx + 256 * (l + 1);
    let mlen = Math.floor(datalen / 4);
    let offset = 0;
    while (mlen > 0) {
      let w = this.convertBytesToBigInt(bigIntData.slice(offset, offset + 4));
      w ^= r[0];
      const p0 = tab0idx + (l + 1) * Number(w >> BigInt(0) & BigInt(255));
      const p1 = tab1idx + (l + 1) * Number(w >> BigInt(8) & BigInt(255));
      const p2 = tab2idx + (l + 1) * Number(w >> BigInt(16) & BigInt(255));
      const p3 = tab3idx + (l + 1) * Number(w >> BigInt(24) & BigInt(255));
      for (let i = 0; i < l; i++) {
        r[i] = r[i + 1] ^ this.ECCstate.cyclic_tab[Number(p0) + i] ^ this.ECCstate.cyclic_tab[Number(p1) + i] ^ this.ECCstate.cyclic_tab[Number(p2) + i] ^ this.ECCstate.cyclic_tab[Number(p3) + i];
      }
      r[l] = this.ECCstate.cyclic_tab[Number(p0) + l] ^ this.ECCstate.cyclic_tab[Number(p1) + l] ^ this.ECCstate.cyclic_tab[Number(p2) + l] ^ this.ECCstate.cyclic_tab[Number(p3) + l];
      mlen--;
      offset += 4;
    }
    bigIntData = bigIntData.slice(offset);
    let leftdata = bigIntData.length;
    ecc = r;
    let posn = 0;
    while (leftdata) {
      const tmp = bigIntData[posn];
      posn++;
      let pidx = (l + 1) * Number(ecc[0] >> BigInt(24) ^ tmp & BigInt(255));
      for (let i = 0; i < l; i++) {
        ecc[i] = (ecc[i] << BigInt(8) & BigInt(4294967295) | ecc[i + 1] >> BigInt(24)) ^ this.ECCstate.cyclic_tab[Number(pidx)];
        pidx++;
      }
      ecc[l] = ecc[l] << BigInt(8) & BigInt(4294967295) ^ this.ECCstate.cyclic_tab[Number(pidx)];
      leftdata--;
    }
    this.ECCstate.ecc_buf = ecc;
    let eccout = [];
    for (const e of r) {
      eccout.push(Number(e >> BigInt(24)) & 255);
      eccout.push(Number(e >> BigInt(16)) & 255);
      eccout.push(Number(e >> BigInt(8)) & 255);
      eccout.push(Number(e >> BigInt(0)) & 255);
    }
    eccout = eccout.slice(0, this.getEccBytes());
    const eccbytes = new Uint8Array(eccout);
    return eccbytes;
  }
  /**
   * Decodes the data and corrects errors using ECC.
   * @param {number[]} data - The input data array.
   * @param {Uint8Array} recvecc - The received ECC data.
   * @returns {any} - The corrected data and status.
   */
  decode(data, recvecc) {
    this.encode(data);
    const eccbuf = this.convertAllBitsToBigInts(Array.from(recvecc), 32);
    const eccwords = this.ceilop(this.ECCstate.m * this.ECCstate.t, 32);
    let sum = BigInt(0);
    for (let i = 0; i < eccwords; i++) {
      this.ECCstate.ecc_buf[i] = this.ECCstate.ecc_buf[i] ^ eccbuf[i];
      sum = sum | this.ECCstate.ecc_buf[i];
    }
    const dataout = this.convertAllBitsToBigInts(data, 8);
    if (sum === BigInt(0)) {
      return {
        bitflips: 0,
        valid: true,
        binary: this.toBinString(dataout, data.length),
        hex: this.toHexString(dataout, data.length),
        ascii: this.toAsciiString(dataout)
      };
    }
    let s = this.ECCstate.ecc_bits;
    let t = this.ECCstate.t;
    const syn = new Array(2 * t).fill(0);
    const m = s & 31;
    const synbuf = this.ECCstate.ecc_buf;
    if (m) {
      synbuf[Math.floor(s / 32)] = synbuf[Math.floor(s / 32)] & ~BigInt(Math.pow(2, Number(32 - m)) - 1);
    }
    let synptr = 0;
    while (s > 0 || synptr === 0) {
      let poly = synbuf[synptr];
      synptr += 1;
      s -= 32;
      while (poly) {
        const i = this.degBigInt(poly);
        for (let j = 0; j < 2 * t; j += 2) {
          syn[j] = syn[j] ^ this.g_pow(this, (j + 1) * (i + s));
        }
        poly = poly ^ BigInt(Math.pow(2, i));
      }
    }
    for (let i = 0; i < t; i++) {
      syn[2 * i + 1] = this.g_sqrt(this, syn[i]);
    }
    const n = this.ECCstate.n;
    t = this.ECCstate.t;
    let pp = -1;
    let pd = 1;
    let pelp = { deg: 0, c: new Array(2 * t).fill(0) };
    pelp.c[0] = 1;
    const elp = { deg: 0, c: new Array(2 * t).fill(0) };
    elp.c[0] = 1;
    let d = syn[0];
    let elp_copy;
    for (let i = 0; i < t; i++) {
      if (elp.deg > t) {
        break;
      }
      if (d) {
        const k = 2 * i - pp;
        elp_copy = JSON.parse(JSON.stringify(elp));
        let tmp = this.g_log(this, d) + n - this.g_log(this, pd);
        for (let j = 0; j <= pelp.deg; j++) {
          if (pelp.c[j] !== BigInt(0)) {
            const l = this.g_log(this, pelp.c[j]);
            elp.c[j + k] = elp.c[j + k] ^ this.g_pow(this, tmp + l);
          }
        }
        tmp = pelp.deg + k;
        if (tmp > elp.deg) {
          elp.deg = tmp;
          pelp = JSON.parse(JSON.stringify(elp_copy));
          pd = d;
          pp = 2 * i;
        }
      }
      if (i < t - 1) {
        d = syn[2 * i + 2];
        for (let j = 1; j <= elp.deg; j++) {
          d = d ^ this.g_mul(this, elp.c[j], syn[2 * i + 2 - j]);
        }
      }
    }
    this.ECCstate.elp = elp;
    const nroots = this.getRoots(this, dataout.length, this.ECCstate.elp);
    const datalen = dataout.length;
    const nbits = datalen * 8 + this.ECCstate.ecc_bits;
    if (nroots === -1) {
      return { valid: false };
    }
    for (let i = 0; i < nroots; i++) {
      if (this.ECCstate.errloc[i] >= nbits) {
        return -1;
      }
      this.ECCstate.errloc[i] = nbits - 1 - this.ECCstate.errloc[i];
      this.ECCstate.errloc[i] = this.ECCstate.errloc[i] & ~7 | 7 - (this.ECCstate.errloc[i] & 7);
    }
    for (const bitflip of this.ECCstate.errloc) {
      const byte = Math.floor(bitflip / 8);
      const bit = Math.pow(2, bitflip & 7);
      if (bitflip < (dataout.length + recvecc.length) * 8) {
        if (byte < dataout.length) {
          dataout[byte] = dataout[byte] ^ BigInt(bit);
        } else {
          recvecc[byte - dataout.length] = recvecc[byte - dataout.length] ^ bit;
        }
      }
    }
    return {
      bitflips: nroots,
      valid: true,
      binary: this.toBinString(dataout, data.length),
      hex: this.toHexString(dataout, data.length),
      ascii: this.toAsciiString(dataout)
    };
  }
  /**
   * Finds the roots of a polynomial.
   * @param {any} instance - The instance of the ECC state.
   * @param {number} k - The degree of the polynomial.
   * @param {any} poly - The polynomial.
   * @returns {number} - The number of roots found.
   */
  getRoots(instance, k, poly) {
    const roots = [];
    if (poly.deg > 2) {
      k = k * 8 + instance.ECCstate.ecc_bits;
      const rep = new Array(instance.ECCstate.t * 2).fill(0);
      const d = poly.deg;
      const l = instance.ECCstate.n - this.g_log(instance, poly.c[poly.deg]);
      for (let i = 0; i < d; i++) {
        if (poly.c[i]) {
          rep[i] = this.mod(instance, this.g_log(instance, poly.c[i]) + l);
        } else {
          rep[i] = -1;
        }
      }
      rep[poly.deg] = 0;
      const syn0 = this.g_div(instance, poly.c[0], poly.c[poly.deg]);
      for (let i = instance.ECCstate.n - k + 1; i < instance.ECCstate.n + 1; i++) {
        let syn = syn0;
        for (let j = 1; j < poly.deg + 1; j++) {
          const m = rep[j];
          if (m >= 0) {
            syn = syn ^ this.g_pow(instance, m + j * i);
          }
        }
        if (syn === 0) {
          roots.push(instance.ECCstate.n - i);
          if (roots.length === poly.deg) {
            break;
          }
        }
      }
      if (roots.length < poly.deg) {
        instance.ECCstate.errloc = [];
        return -1;
      }
    }
    if (poly.deg === 1) {
      if (poly.c[0]) {
        roots.push(
          this.mod(
            instance,
            instance.ECCstate.n - instance.ECCstate.logarithms[poly.c[0]] + instance.ECCstate.logarithms[poly.c[1]]
          )
        );
      }
    }
    if (poly.deg === 2) {
      if (poly.c[0] && poly.c[1]) {
        const l0 = instance.ECCstate.logarithms[poly.c[0]];
        const l1 = instance.ECCstate.logarithms[poly.c[1]];
        const l2 = instance.ECCstate.logarithms[poly.c[2]];
        const u = this.g_pow(instance, l0 + l2 + 2 * (instance.ECCstate.n - l1));
        let r = 0;
        let v = u;
        while (v) {
          const i = this.deg(v);
          r = r ^ instance.ECCstate.elp_pre[i];
          v = v ^ Math.pow(2, i);
        }
        if (this.g_sqrt(instance, r) ^ Number(r === u)) {
          roots.push(this.modn(instance, 2 * instance.ECCstate.n - l1 - instance.ECCstate.logarithms[r] + l2));
          roots.push(this.modn(instance, 2 * instance.ECCstate.n - l1 - instance.ECCstate.logarithms[r ^ 1] + l2));
        }
      }
    }
    instance.ECCstate.errloc = roots;
    return roots.length;
  }
  /**
   * Gets the number of ECC bits.
   * @returns {number} - The number of ECC bits.
   */
  getEccBits() {
    return this.ECCstate.ecc_bits;
  }
  /**
   * Gets the number of ECC bytes.
   * @returns {number} - The number of ECC bytes.
   */
  getEccBytes() {
    return Math.ceil(this.ECCstate.m * this.ECCstate.t / 8);
  }
  /**
   * Builds a cyclic table for error correction.
   * @param {bigint[]} g - The generator polynomial.
   */
  buildCyclic(g) {
    const l = Math.ceil(this.ECCstate.m * this.ECCstate.t / 32);
    const plen = Math.ceil((this.ECCstate.ecc_bits + 1) / 32);
    const ecclen = Math.ceil(this.ECCstate.ecc_bits / 32);
    this.ECCstate.cyclic_tab = new Array(4 * 256 * l).fill(BigInt(0));
    for (let i = 0; i < 256; i++) {
      for (let b = 0; b < 4; b++) {
        const offset = (b * 256 + i) * l;
        let data = BigInt(i) << BigInt(8 * b);
        while (data) {
          const d = this.degBigInt(data);
          data ^= g[0] >> BigInt(31 - d);
          for (let j = 0; j < ecclen; j++) {
            let hi, lo;
            if (d < 31) {
              hi = BigInt(g[j] << BigInt(d + 1)) & BigInt(4294967295);
            } else {
              hi = BigInt(0);
            }
            if (j + 1 < plen) {
              lo = g[j + 1] >> BigInt(31 - d);
            } else {
              lo = BigInt(0);
            }
            if (this.ECCstate.cyclic_tab[j + offset] === BigInt(0)) {
              this.ECCstate.cyclic_tab[j + offset] = BigInt(0);
            }
            this.ECCstate.cyclic_tab[j + offset] ^= hi | lo;
          }
        }
      }
    }
  }
  /** GALOIS OPERATIONS */
  /**
   * Computes the power of a value in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param i - The exponent value.
   * @returns The result of raising a value to the power i in the Galois field.
   */
  g_pow(instance, i) {
    return instance.ECCstate.exponents[this.modn(instance, i)];
  }
  /**
   * Computes the square root of a value in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param a - The value whose square root is to be computed.
   * @returns The square root of the value in the Galois field.
   */
  g_sqrt(instance, a) {
    if (a) {
      return instance.ECCstate.exponents[this.mod(instance, 2 * instance.ECCstate.logarithms[a])];
    } else {
      return 0;
    }
  }
  /**
   * Computes the logarithm of a value in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param x - The value whose logarithm is to be computed.
   * @returns The logarithm of the value in the Galois field.
   */
  g_log(instance, x) {
    return instance.ECCstate.logarithms[x];
  }
  /**
   * Multiplies two values in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param a - The first value to be multiplied.
   * @param b - The second value to be multiplied.
   * @returns The product of the two values in the Galois field.
   */
  g_mul(instance, a, b) {
    if (a > 0 && b > 0) {
      const res = this.mod(instance, instance.ECCstate.logarithms[a] + instance.ECCstate.logarithms[b]);
      return instance.ECCstate.exponents[res];
    } else {
      return 0;
    }
  }
  /**
   * Divides two values in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param a - The dividend.
   * @param b - The divisor.
   * @returns The quotient of the division in the Galois field.
   */
  g_div(instance, a, b) {
    if (a) {
      return instance.ECCstate.exponents[this.mod(instance, instance.ECCstate.logarithms[a] + instance.ECCstate.n - instance.ECCstate.logarithms[b])];
    } else {
      return 0;
    }
  }
  /**
   * Reduces a value modulo the Galois field size.
   * @param instance - The current context containing Galois field parameters.
   * @param v - The value to be reduced.
   * @returns The value reduced modulo the Galois field size.
   */
  mod(instance, v) {
    if (v < instance.ECCstate.n) {
      return v;
    } else {
      return v - instance.ECCstate.n;
    }
  }
  /**
   * Reduces a value modulo the Galois field size.
   * @param instance - The current context containing Galois field parameters.
   * @param v - The value to be reduced.
   * @returns The value reduced modulo the Galois field size.
   */
  modn(instance, v) {
    const n = instance.ECCstate.n;
    while (v >= n) {
      v -= n;
      v = (v & n) + (v >> instance.ECCstate.m);
    }
    return v;
  }
  /**
   * Computes the degree of a polynomial represented as an integer.
   * @param x - The polynomial represented as an integer.
   * @returns The degree of the polynomial.
   */
  deg(x) {
    let count = 0;
    while (x >> 1) {
      x = x >> 1;
      count += 1;
    }
    return count;
  }
  /**
   * Computes the ceiling of the division of two integers.
   * @param a - The dividend.
   * @param b - The divisor.
   * @returns The ceiling of the division of a by b.
   */
  ceilop(a, b) {
    return Math.floor((a + b - 1) / b);
  }
  /**
   * Computes the degree of a polynomial represented as a BigInt.
   * @param x - The polynomial represented as a BigInt.
   * @returns The degree of the polynomial.
   */
  degBigInt(x) {
    let count = 0;
    while (x >> BigInt(1)) {
      x = x >> BigInt(1);
      count += 1;
    }
    return count;
  }
  /**
   * Converts an array of bits into a single BigInt value.
   * @param {number[]} bitArray - The array of bits to convert.
   * @param {number} bitLimit - The maximum number of bits to process.
   * @returns {BigInt} - The combined value of all bits in the array.
   */
  convertBitsToBigInt(bitArray, bitLimit) {
    let result = BigInt(0);
    if (bitLimit < bitArray.length) {
      bitLimit = bitArray.length;
    }
    let pos = bitLimit - 1;
    for (let b = 0; b < bitLimit; b++) {
      if (bitArray[b]) {
        result += BigInt(1) << BigInt(pos);
      }
      pos--;
    }
    return result;
  }
  /**
   * Processes an array of bits in chunks, converting each chunk into a BigInt.
   * @param {number[]} bitArray - The array of bits to process.
   * @param {number} chunkSize - The size of each chunk of bits to process.
   * @returns {BigInt[]} - An array of BigInt values representing chunks of the original bit array.
   */
  convertAllBitsToBigInts(bitArray, chunkSize) {
    const dataLength = bitArray.length;
    let numChunks = Math.floor(dataLength / chunkSize);
    const resultArray = [];
    let offset = 0;
    while (numChunks > 0) {
      const chunk = bitArray.slice(offset, offset + chunkSize);
      const bigInt = this.convertBitsToBigInt(chunk, chunkSize);
      resultArray.push(bigInt);
      offset += chunkSize;
      numChunks--;
    }
    const remainingBitsArray = bitArray.slice(offset);
    if (remainingBitsArray.length > 0) {
      const bigInt = this.convertBitsToBigInt(remainingBitsArray, chunkSize);
      resultArray.push(bigInt);
    }
    return resultArray;
  }
  /**
   * Converts an array of up to 4 bytes into a single BigInt value.
   * @param {bigint[]} byteArray - The array of bytes to convert.
   * @returns {BigInt} - The combined value of the bytes as a BigInt.
   */
  convertBytesToBigInt(byteArray) {
    let result = BigInt(0);
    if (byteArray.length > 0) result += byteArray[0] << BigInt(24);
    if (byteArray.length > 1) result += byteArray[1] << BigInt(16);
    if (byteArray.length > 2) result += byteArray[2] << BigInt(8);
    if (byteArray.length > 3) result += byteArray[3];
    return result;
  }
  /**
   * Generates a binary string from data.
   * @param {any[]} dataout - The data output array.
   * @param {number} datalen - The desired length of the binary string.
   * @returns {string} - The binary string representation of the data.
   */
  toBinString(dataout, datalen) {
    let out = "";
    for (const byte of dataout) {
      out += this.numberToBinaryString(byte, 8);
    }
    out = out.slice(0, datalen);
    return out;
  }
  /**
   * Converts a number to a binary string of a given length.
   * @param {number} num - The number to convert.
   * @param {number} length - The desired length of the binary string.
   * @returns {string} - The binary string representation of the number.
   */
  numberToBinaryString(num, length) {
    let binaryString = num.toString(2);
    while (binaryString.length < length) {
      binaryString = "0" + binaryString;
    }
    return binaryString;
  }
  /**
   * Decodes a Uint8Array to a string using 7-bit ASCII encoding.
   * @param {Uint8Array} data - The input byte array.
   * @returns {string} - The decoded string.
   */
  toAsciiString(data) {
    const textBitStr = data.map((byte) => byte.toString(2).padStart(8, "0")).join("");
    const textInt7 = [];
    for (let i = 0; i < textBitStr.length; i += 7) {
      const bitSegment = textBitStr.slice(i, i + 7);
      textInt7.push(parseInt(bitSegment, 2));
    }
    const textBytes = new Uint8Array(textInt7);
    const decodedText = new TextDecoder("utf-8").decode(textBytes).replace(/\0/g, "");
    return decodedText;
  }
  /**
   * Converts an array of numbers to a hexadecimal string.
   * @param {any[]} data - The array of numbers to convert.
   * @returns {string} - The hexadecimal string representation of the numbers.
   */
  toHexString(data, datalen) {
    if (data.length > datalen / 8) {
      data.pop();
    }
    return data.map(function(byte) {
      byte = Number(byte);
      if (byte > 15) return (byte & 255).toString(16);
      else return "0" + (byte & 255).toString(16);
    }).join("");
  }
};

// src/datalayer.ts
var BCH_POLYNOMIAL = 137;
var DataLayer = class {
  payload_len;
  // Length of the payload in bits
  encoding_mode;
  // Encoding mode to be used
  versionbits;
  // Number of bits for the schema version
  bch_encoder;
  // BCH encoder instance
  bch_decoders;
  // Dictionary of BCH decoders for different schemas
  /**
   * Initializes the DataLayer with specified parameters.
   * @param {number} payload_len - The length of the payload in bits.
   * @param {boolean} verbose - Flag to indicate if messages should be logged.
   * @param {number} encoding_mode - The encoding mode to be used (default is 0).
   */
  constructor(payload_len, verbose, encoding_mode) {
    this.bch_encoder = this.buildBCH(encoding_mode);
    this.encoding_mode = encoding_mode;
    this.versionbits = 4;
    this.bch_decoders = {};
    for (let i = 0; i < 4; i++) {
      this.bch_decoders[i] = this.buildBCH(i);
    }
    this.payload_len = payload_len;
  }
  /**
   * Builds and returns a BCH instance based on the given encoding mode.
   *
   * @param encoding_mode The encoding mode.
   * @returns A BCH instance configured for the specified encoding mode.
   */
  buildBCH(encoding_mode) {
    switch (encoding_mode) {
      case 1:
        return new BCH(5, BCH_POLYNOMIAL);
      case 2:
        return new BCH(4, BCH_POLYNOMIAL);
      case 3:
        return new BCH(3, BCH_POLYNOMIAL);
      default:
        return new BCH(8, BCH_POLYNOMIAL);
    }
  }
  /**
   * Encodes a text string into a Float32Array with the ECC encoding.
   * @param {string} text - The input text string.
   * @returns {Float32Array} - The encoded Float32Array.
   */
  encodeText(text) {
    const data = this.encodeAscii(text);
    const packet_d = Array.from(data).map((x) => x.toString(2).padStart(8, "0")).join("");
    return this.encodePacket(packet_d);
  }
  /**
   * Encodes a binary string into a Float32Array with the ECC encoding.
   * @param {string} strbin - The input binary string.
   * @returns {Float32Array} - The encoded Float32Array with the ECC encoding.
   */
  encodeBinary(strbin) {
    return this.encodePacket(String(strbin));
  }
  /**
   * Processes and encodes the packet data.
   * @param {string} packet_d - The binary string representation of the packet data.
   * @returns {Float32Array} - The encoded Float32Array.
   */
  encodePacket(packet_d) {
    const data_bitcount = this.payload_len - this.bch_encoder.getEccBits() - this.versionbits;
    const ecc_bitcount = this.bch_encoder.getEccBits();
    packet_d = packet_d.substring(0, data_bitcount);
    packet_d = packet_d.padEnd(data_bitcount, "0");
    const pad_d = packet_d.length % 8 === 0 ? 0 : 8 - packet_d.length % 8;
    const paddedpacket_d = packet_d + "0".repeat(pad_d);
    const padded_data = Array.from(paddedpacket_d.split("").map(Number));
    const ecc = this.bch_encoder.encode(padded_data);
    let packet_e = Array.from(ecc).map((x) => x.toString(2).padStart(8, "0")).join("");
    packet_e = packet_e.substring(0, ecc_bitcount);
    const pad_e = packet_e.length % 8 === 0 || this.encoding_mode !== 0 ? 0 : 8 - packet_e.length % 8;
    packet_e = packet_e.padEnd(packet_e.length + pad_e, "0");
    const version = this.encoding_mode;
    const packet_v = version.toString(2).padStart(4, "0");
    let packet = packet_d + packet_e + packet_v;
    packet = packet.split("").map((x) => parseInt(x, 10)).join("");
    if (this.payload_len !== packet.length) {
      throw new Error("Error! Could not form complete packet");
    }
    return new Float32Array(packet.split("").map(Number));
  }
  /**
   * Encodes a string to a Float32Array using 7-bit ASCII encoding.
   * @param {string} text - The input text string.
   * @returns {Float32Array} - The encoded Float32Array.
   */
  encodeAscii(text) {
    const textInt7 = Array.from(text).map((t) => t.charCodeAt(0) & 127);
    let textBitStr = textInt7.map((t) => t.toString(2).padStart(7, "0")).join("");
    if (textBitStr.length % 8 !== 0) {
      textBitStr = textBitStr.padEnd(textBitStr.length + (8 - textBitStr.length % 8), "0");
    }
    const byteArray = [];
    for (let i = 0; i < textBitStr.length; i += 8) {
      byteArray.push(parseInt(textBitStr.slice(i, i + 8), 2));
    }
    return new Float32Array(byteArray);
  }
};
function getSchemaCapacity(schema_version) {
  switch (schema_version) {
    case 0:
      return 40;
    case 1:
      return 61;
    case 2:
      return 68;
    case 3:
      return 75;
    default:
      throw new Error("Invalid schema version");
  }
}
function getSchemaVersion(binary_array) {
  const last_two_bits = binary_array.slice(-2);
  const version = last_two_bits[0] * 2 + last_two_bits[1];
  return version;
}

// src/ONNX_HUB_MANIFEST.json
var ONNX_HUB_MANIFEST_default = [
  {
    model: "Trustmark variant Q encoder",
    model_name: "encoder_Q.onnx",
    model_remote_host: "https://cc-assets.netlify.app",
    model_path: "/watermarking/trustmark-models/encoder_Q.onnx",
    onnx_version: "1.9.0",
    opset_version: 17,
    metadata: {
      model_sha: "19b3d1b25836130ffd78775a8f61539f993375d1823ef0e59ba5b8dffb4f892d",
      model_bytes: 17312208,
      tags: ["watermarking"],
      io_ports: {
        inputs: [
          {
            name: " onnx::Concat_0",
            shape: [1, 3, 256, 256],
            type: "tensor(float)"
          },
          {
            name: "onnx::Gemm_1",
            shape: [1, 100],
            type: "tensor(float)"
          }
        ],
        outputs: [
          {
            name: "image",
            shape: [1, 3, 256, 256],
            type: "tensor(float)"
          }
        ]
      }
    }
  },
  {
    model: "Trustmark variant Q decoder",
    model_name: "decoder_Q.onnx",
    model_remote_host: "https://cc-assets.netlify.app",
    model_path: "/watermarking/trustmark-models/decoder_Q.onnx",
    onnx_version: "1.9.0",
    opset_version: 17,
    metadata: {
      model_sha: "ee3268f057c9dabef680e169302f5973d0589feea86189ed229a896cc3aa88df",
      model_bytes: 47401222,
      tags: ["watermarking"],
      io_ports: {
        inputs: [
          {
            name: "image",
            shape: [1, 3, 256, 256],
            type: "tensor(float)"
          }
        ],
        outputs: [
          {
            name: "output",
            shape: [1, 100],
            type: "tensor(float)"
          }
        ]
      }
    }
  }
];

// src/trustmark.ts
var MODELS_PATH = "models/";
var ASPECT_RATIO_LIM = 2;
var IS_BROWSER = false;
var IS_NODE = false;
if (typeof window === "undefined") {
  IS_NODE = true;
} else {
  IS_BROWSER = true;
}
var VERBOSE = true;
var TrustMark = class _TrustMark {
  /** * Static encoding mapping for different BCH modes. */
  static encoding = {
    undefined: -1,
    BCH_SUPER: 0,
    BCH_3: 3,
    BCH_4: 2,
    BCH_5: 1
  };
  use_ecc;
  secret_len;
  ecc;
  decoder_session;
  encoder_session;
  preprocess_session;
  /**
   * Constructs a new TrustMark instance.
   * @param {boolean} [use_ecc=true] - use BCH error correction on the payload, reducing payload size (default)
   * @param {number} [secret_len=100] - The length of the secret.
   * @param {number} [encoding_mode=TrustMark.encoding.BCH_4] - The data schema encoding mode to use.
   */
  constructor(use_ecc = true, secret_len = 100, encoding_mode = _TrustMark.encoding.BCH_4) {
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
  async decode(image_url) {
    tf.engine().startScope();
    const stego_image = await this.loadImage(image_url);
    await sleep(0);
    tf.engine().endScope();
    const input_feeds = { image: stego_image.onnx };
    const start_time = /* @__PURE__ */ new Date();
    const model_output = await this.decoder_session.run(input_feeds);
    const time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
    tsLog(`Prediction: ${time_elapsed}ms`);
    await sleep(0);
    const output_data = model_output.output.cpuData;
    const binary_array = output_data.map((value) => value >= 0 ? 1 : 0);
    const schema = getSchemaVersion(binary_array);
    let data_bits = getSchemaCapacity(schema);
    let data = binary_array.slice(0, data_bits);
    let ecc = binary_array.slice(data_bits, 96);
    let decoded_data = this.ecc.bch_decoders[schema].decode(data, ecc);
    decoded_data.schema = schema;
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
  async encode(image_url, string_secret, wm_strength = 0.4, maculate = false, output = "bytes") {
    tf.engine().startScope();
    const cover_image = await this.loadImage(image_url);
    let mode;
    let secret = new Float32Array(100);
    if (maculate === true) {
      mode = "binary";
      secret.set(
        Float32Array.from({ length: 96 }, () => Math.round(Math.random())),
        0
      );
      secret.set([0, 0, 0, 0], 96);
    } else {
      const binary_count = string_secret.match(/[01]/g);
      if (binary_count && binary_count.length == string_secret.length) {
        mode = "binary";
      } else {
        mode = "text";
      }
      if (!this.use_ecc) {
        if (mode === "binary") {
          secret = new Float32Array(Array.from(string_secret).map(Number));
        } else {
          secret = this.ecc.encodeAscii(string_secret);
          secret = new Float32Array(Array.from(secret).map(Number));
        }
      } else {
        if (mode === "binary") {
          secret = this.ecc.encodeBinary(string_secret);
        } else {
          secret = this.ecc.encodeText(string_secret);
        }
      }
    }
    cover_image.onnx_secret = new ort.Tensor("float32", secret, [1, 100]);
    const input_feeds = { "onnx::Concat_0": cover_image.onnx, "onnx::Gemm_1": cover_image.onnx_secret };
    let start_time = /* @__PURE__ */ new Date();
    const model_output = await this.encoder_session.run(input_feeds);
    let time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
    tsLog(`Inference: ${time_elapsed}ms`);
    await sleep(0);
    start_time = /* @__PURE__ */ new Date();
    const tf_cover = tf.tensor(cover_image.onnx.cpuData, [1, 3, 256, 256]);
    const tf_stego = tf.tensor(model_output.image.cpuData, [1, 3, 256, 256]);
    let tf_residual = tf.clipByValue(tf_stego, -1, 1).sub(tf_cover).squeeze().transpose([1, 2, 0]);
    tf_cover.dispose();
    tf_stego.dispose();
    if (IS_NODE && VERBOSE || IS_BROWSER) {
      const residual_display = tf_residual.mul(10).clipByValue(0, 1);
      if (IS_NODE) {
        if (output == "png") {
          cover_image.residual = await tf.node.encodePng(residual_display.mul(255));
        } else {
          cover_image.residual = await tf.browser.toPixels(residual_display);
        }
      } else {
        cover_image.residual = await tf.browser.toPixels(residual_display);
      }
      residual_display.dispose();
    }
    tf_residual = tf.image.resizeBilinear(tf_residual, [cover_image.crop_height, cover_image.crop_width]);
    time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
    tsLog(`Residual Interpolation: ${time_elapsed}ms`);
    await sleep(0);
    start_time = /* @__PURE__ */ new Date();
    let tf_merge = tf.clipByValue(tf.add(tf_residual.mul(wm_strength), cover_image.tf_crop), 0, 1);
    if (cover_image.aspect_ratio > 2) {
      if (cover_image.orientation == "landscape") {
        const axe_length = Math.floor((cover_image.width - cover_image.crop_axe) / 2);
        const part_a = cover_image.tf_source.slice([0, 0, 0], [cover_image.crop_axe, axe_length, 3]);
        const part_b = cover_image.tf_source.slice(
          [0, axe_length + cover_image.crop_axe, 0],
          [cover_image.crop_axe, cover_image.width - axe_length - cover_image.crop_axe, 3]
        );
        tf_merge = tf.concat([part_a, tf_merge, part_b], 1);
      }
      if (cover_image.orientation == "portrait") {
        const axe_length = Math.floor((cover_image.height - cover_image.crop_axe) / 2);
        const part_a = cover_image.tf_source.slice([0, 0, 0], [axe_length, cover_image.crop_axe, 3]);
        const part_b = cover_image.tf_source.slice(
          [axe_length + cover_image.crop_axe, 0, 0],
          [cover_image.height - axe_length - cover_image.crop_axe, cover_image.crop_axe, 3]
        );
        tf_merge = tf.concat([part_a, tf_merge, part_b], 0);
      }
    }
    cover_image.tf_crop.dispose();
    tf_residual.dispose();
    time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
    tsLog(`Compositing: ${time_elapsed}ms`);
    await sleep(0);
    start_time = /* @__PURE__ */ new Date();
    if (IS_NODE) {
      if (output == "png") {
        cover_image.stego = await tf.node.encodePng(tf_merge.mul(255));
      } else {
        cover_image.stego = await tf.browser.toPixels(tf_merge);
      }
    } else {
      cover_image.stego = await tf.browser.toPixels(tf_merge);
    }
    time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
    tsLog(`Encoding: ${time_elapsed}ms`);
    await sleep(0);
    tf.engine().endScope();
    return {
      stego: cover_image.stego,
      residual: cover_image.residual ? cover_image.residual : new Uint8Array(),
      height: cover_image.height,
      width: cover_image.width
    };
  }
  /**
   * Processes an image and returns the processed data.
   *
   * @param image The input image data.
   * @returns A promise that resolves with the processed image data or rejects with an error.
   */
  async processImage(image2) {
    const start_time = /* @__PURE__ */ new Date();
    image2.width = image2.tf_source.shape[2];
    image2.height = image2.tf_source.shape[1];
    if (image2.width > image2.height) {
      image2.orientation = "landscape";
      image2.aspect_ratio = image2.width / image2.height;
    } else {
      image2.orientation = "portrait";
      image2.aspect_ratio = image2.height / image2.width;
    }
    if (image2.aspect_ratio > ASPECT_RATIO_LIM) {
      const size = Math.min(image2.width, image2.height);
      const left = (image2.width - size) / 2;
      const top = (image2.height - size) / 2;
      image2.tf_crop = tf.image.cropAndResize(
        image2.tf_source,
        [[top / image2.height, left / image2.width, (top + size) / image2.height, (left + size) / image2.width]],
        [0],
        [size, size],
        "nearest"
      );
      image2.crop_axe = image2.crop_width = image2.crop_height = size;
    } else {
      image2.tf_crop = image2.tf_source;
      image2.crop_width = image2.width;
      image2.crop_height = image2.height;
    }
    image2.tf_source = image2.tf_source.squeeze();
    image2.tf_crop = image2.tf_crop.transpose([0, 3, 1, 2]);
    const data = image2.tf_crop.dataSync();
    const onnxTensor = new ort.Tensor("float32", data, image2.tf_crop.shape);
    image2.tf_crop = image2.tf_crop.transpose([0, 2, 3, 1]);
    image2.tf_crop = image2.tf_crop.squeeze();
    image2.onnx = (await this.preprocess_session.run({ input: onnxTensor })).output;
    await sleep(0);
    const time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
    tsLog(`Processing: ${image2.width}x${image2.height}: ${time_elapsed}ms`);
    return image2;
  }
  /**
   * Loads an image from a given URL and processes it.
   *
   * @param image_url The URL of the image to load.
   * @returns A promise that resolves with the processed image data or rejects with an error.
   */
  async loadImage(image_url) {
    return new Promise(async (resolve) => {
      const start_time = /* @__PURE__ */ new Date();
      const image2 = { url: image_url };
      if (IS_NODE) {
        const image_buffer = (0, import_node_fs.readFileSync)(image2.url);
        image2.tf_source = tf.node.decodeImage(image_buffer).expandDims(0).div(255);
      } else {
        const img = new Image();
        img.onload = async () => {
          image2.tf_source = tf.browser.fromPixels(img).expandDims(0).div(255);
          const time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
          tsLog(`Loading: ${time_elapsed}ms`);
          resolve(await this.processImage(image2));
        };
        img.src = image2.url;
      }
      if (IS_NODE) {
        const time_elapsed = (/* @__PURE__ */ new Date()).getTime() - start_time.getTime();
        tsLog(`Loading: ${time_elapsed}ms`);
        resolve(await this.processImage(image2));
      }
    });
  }
  /**
   * Loads the ONNX models for preprocessing, encoding, and decoding.
   */
  async loadModels() {
    const models = await getModels();
    const decoder_model_url = models["decoder_Q.onnx"];
    const encoder_model_url = models["encoder_Q.onnx"];
    const session_option = { executionProviders: ["cpu"] };
    this.preprocess_session = await ort.InferenceSession.create("models/preprocess.onnx").catch((error) => {
      throw new Error(`Error loading preprocessing ONNX model: ${error}`);
    });
    this.decoder_session = await ort.InferenceSession.create(decoder_model_url, session_option).catch((error) => {
      throw new Error(`Error loading decoder ONNX model: ${error}`);
    });
    this.encoder_session = await ort.InferenceSession.create(encoder_model_url, session_option).catch((error) => {
      throw new Error(`Error loading encoder ONNX model: ${error}`);
    });
  }
};
async function getModels() {
  return new Promise(async (resolve, reject) => {
    const fetchs = [];
    const models = {};
    for (const model of ONNX_HUB_MANIFEST_default) {
      const model_url = model.model_remote_host + model.model_path;
      const model_path = MODELS_PATH + model.model_name;
      const model_bytes = model.metadata.model_bytes;
      if (IS_NODE) {
        if ((0, import_node_fs.existsSync)(model_path)) {
          models[model.model_name] = model_path;
        } else {
          tsLog(`'${model_path}' needs to be fetched and cached from remote repository.`);
          fetchs.push(fetchModel(model_url, model_path, model.model_name, model.metadata.model_sha, model_bytes));
        }
      } else {
        await restoreFileFromCache(model.model_name).then((file) => {
          models[model.model_name] = file;
        }).catch((e) => {
          tsLog(model.model_name + " needs to be fetched and cached from remote repository.");
          fetchs.push(fetchModel(model_url, model_path, model.model_name, model.metadata.model_sha, model_bytes));
        });
      }
    }
    await Promise.all(fetchs).then((fmodels) => {
      fmodels.forEach(function(fmodel) {
        models[fmodel.model_name] = fmodel.path;
      });
    }).catch((err) => reject(err));
    resolve(models);
  });
}
async function fetchModel(url, file_path, model_name, checksum, model_bytes) {
  return new Promise(async (resolve, reject) => {
    fetch(url).then((response) => {
      return response.body;
    }).then((body) => {
      const reader = body.getReader();
      let charsReceived = 0;
      return new ReadableStream({
        async start(controller) {
          return pump();
          function pump() {
            return reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }
              charsReceived += value.length;
              const progress_percentage = Math.floor(charsReceived / model_bytes * 100);
              if (IS_NODE) {
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
                process.stdout.write(`Progress: ${drawProgressBar(progress_percentage)} of ${model_name}`);
              } else {
                tsLog(`Loading model: ${progress_percentage}% of ${file_path}`, true);
              }
              controller.enqueue(value);
              return pump();
            });
          }
        }
      });
    }).then((stream) => new Response(stream)).then((response) => response.arrayBuffer()).then(async (a_buffer) => {
      const file_chacksum = await sha(new Uint8Array(a_buffer));
      if (file_chacksum == checksum) {
        const model = {
          model_name,
          path: a_buffer
        };
        if (IS_NODE) {
          (0, import_node_fs.writeFile)(file_path, new Uint8Array(a_buffer), (err) => {
            if (err) {
              reject(err);
            } else {
              resolve(model);
            }
          });
        } else {
          await storeFileInCache(model_name, new Blob([a_buffer], { type: "application/octet-stream" }));
          resolve(model);
        }
      }
    }).catch((err) => reject(err));
  });
}
async function restoreFileFromCache(model_name) {
  const modelCache = await caches.open("models");
  const response = await modelCache.match(model_name);
  if (!response) {
    throw new Error(`${model_name} not found in cache.`);
  }
  const file = await response.arrayBuffer();
  tsLog(`${model_name} found in cache.`);
  return file;
}
async function storeFileInCache(model_name, blob) {
  try {
    const modelCache = await caches.open("models");
    await modelCache.put(model_name, new Response(blob));
    tsLog(`${model_name} cached`);
  } catch (err) {
    throw new Error(err);
  }
}
function drawProgressBar(progress) {
  const barWidth = 30;
  const filledWidth = Math.floor(progress / 100 * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const progressBar = "\u2588".repeat(filledWidth) + "\u2592".repeat(emptyWidth);
  return `[${progressBar}] ${progress}%`;
}
function sha(content) {
  if (IS_NODE) {
    return (0, import_node_crypto.createHash)("sha256").update(content).digest("hex");
  } else {
    return hash(content);
  }
}
function sleep(m) {
  if (IS_BROWSER) {
    return new Promise((resolve) => setTimeout(resolve, m));
  }
}
function tsLog(str, browser_only = false) {
  if (IS_BROWSER) {
    const payloadevt = new CustomEvent("status", { detail: str });
    window.dispatchEvent(payloadevt);
  }
  if (IS_NODE && browser_only === false && VERBOSE) {
    console.log(str);
  }
}
async function hash(content) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((bytes) => bytes.toString(16).padStart(2, "0")).join("");
  return hashHex;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TrustMark
});
