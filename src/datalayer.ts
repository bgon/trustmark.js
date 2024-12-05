// Copyright 2023 Adobe
// All Rights Reserved.

// NOTICE: Adobe permits you to use, modify, and distribute this file in
// accordance with the terms of the Adobe license agreement accompanying
// it.

// Copyright (C) 2024 Bertrand Gondouin
// Additional changes made by Bertrand Gondouin to port the original
// MIT-licensed Python code to TypeScript are licensed under GPLv3.

import { BCH } from './bchecc';

const BCH_POLYNOMIAL = 137;

/**
 * Data layer for encoding and decoding payloads class.
 * This class utilizes BCH codes for error correction.
 */
export class DataLayer {
  payload_len: number; // Length of the payload in bits
  encoding_mode: number; // Encoding mode to be used
  versionbits: number; // Number of bits for the schema version
  bch_encoder: BCH; // BCH encoder instance
  bch_decoders: Record<number, BCH>; // Dictionary of BCH decoders for different schemas

  /**
   * Initializes the DataLayer with specified parameters.
   * @param {number} payload_len - The length of the payload in bits.
   * @param {boolean} verbose - Flag to indicate if messages should be logged.
   * @param {number} encoding_mode - The encoding mode to be used (default is 0).
   */
  constructor(payload_len: number, verbose: boolean, encoding_mode: number) {
    // Initialize BCH encoder
    this.bch_encoder = this.buildBCH(encoding_mode);
    this.encoding_mode = encoding_mode;
    this.versionbits = 4;
    this.bch_decoders = {};

    // Initialize BCH decoders for different schemas
    for (let i = 0; i < 4; i++) {
      this.bch_decoders[i] = this.buildBCH(i);
    }

    this.payload_len = payload_len; // in bits
  }

  /**
   * Builds and returns a BCH instance based on the given encoding mode.
   *
   * @param encoding_mode The encoding mode.
   * @returns A BCH instance configured for the specified encoding mode.
   */
  buildBCH(encoding_mode: number): BCH {
    switch (encoding_mode) {
      case 1:
        return new BCH(5, BCH_POLYNOMIAL);
      case 2:
        return new BCH(4, BCH_POLYNOMIAL);
      case 3:
        return new BCH(3, BCH_POLYNOMIAL);
      default: // Assume superwatermark/mode 0
        return new BCH(8, BCH_POLYNOMIAL);
    }
  }

  /**
   * Encodes a text string into a Float32Array with the ECC encoding.
   * @param {string} text - The input text string.
   * @returns {Float32Array} - The encoded Float32Array.
   */
  encodeText(text: string): Float32Array {
    // Convert the text to a byte array using 7-bit ASCII encoding.
    const data = this.encodeAscii(text);

    // Convert the byte array to a binary string.
    const packet_d = Array.from(data)
      .map((x) => x.toString(2).padStart(8, '0'))
      .join('');
    // Process the binary string with the ECC encoding.
    return this.encodePacket(packet_d);
  }

  /**
   * Encodes a binary string into a Float32Array with the ECC encoding.
   * @param {string} strbin - The input binary string.
   * @returns {Float32Array} - The encoded Float32Array with the ECC encoding.
   */
  encodeBinary(strbin: string): Float32Array {
    // Process the binary string with the ECC encoding.
    return this.encodePacket(String(strbin));
  }

  /**
   * Processes and encodes the packet data.
   * @param {string} packet_d - The binary string representation of the packet data.
   * @returns {Float32Array} - The encoded Float32Array.
   */
  encodePacket(packet_d: string): Float32Array {
    // Calculate the number of data bits and ECC bits.
    const data_bitcount = this.payload_len - this.bch_encoder.getEccBits() - this.versionbits;
    const ecc_bitcount = this.bch_encoder.getEccBits();

    // Truncate or pad the packet data to the correct length.
    packet_d = packet_d.substring(0, data_bitcount);
    packet_d = packet_d.padEnd(data_bitcount, '0');

    // Pad the data so its length is a multiple of 8.
    const pad_d = packet_d.length % 8 === 0 ? 0 : 8 - (packet_d.length % 8);
    const paddedpacket_d = packet_d + '0'.repeat(pad_d);
    const padded_data: number[] = Array.from(paddedpacket_d.split('').map(Number));

    // Encode the padded data using BCH encoder.
    const ecc = this.bch_encoder.encode(padded_data);
    let packet_e = Array.from(ecc)
      .map((x) => x.toString(2).padStart(8, '0'))
      .join('');
    packet_e = packet_e.substring(0, ecc_bitcount);

    // Pad the ECC to the correct length.
    const pad_e = packet_e.length % 8 === 0 || this.encoding_mode !== 0 ? 0 : 8 - (packet_e.length % 8);
    packet_e = packet_e.padEnd(packet_e.length + pad_e, '0');

    // Encode the version bits.
    const version = this.encoding_mode;
    const packet_v = version.toString(2).padStart(4, '0');

    // Combine data, ECC, and version bits into the final packet.
    let packet = packet_d + packet_e + packet_v;
    packet = packet
      .split('')
      .map((x) => parseInt(x, 10))
      .join('');

    // Ensure the packet length is correct.
    if (this.payload_len !== packet.length) {
      throw new Error('Error! Could not form complete packet');
    }

    return new Float32Array(packet.split('').map(Number));
  }

  /**
   * Encodes a string to a Float32Array using 7-bit ASCII encoding.
   * @param {string} text - The input text string.
   * @returns {Float32Array} - The encoded Float32Array.
   */
  encodeAscii(text: string): Float32Array {
    // Convert each character in the string to its 7-bit ASCII integer representation.
    const textInt7 = Array.from(text).map((t) => t.charCodeAt(0) & 127);

    // Convert each integer to its binary string representation and join them all together.
    let textBitStr = textInt7.map((t) => t.toString(2).padStart(7, '0')).join('');

    // Pad the binary string to a length that is a multiple of 8 if necessary.
    if (textBitStr.length % 8 !== 0) {
      textBitStr = textBitStr.padEnd(textBitStr.length + (8 - (textBitStr.length % 8)), '0');
    }

    // Convert the binary string to a byte array.
    const byteArray: number[] = [];
    for (let i = 0; i < textBitStr.length; i += 8) {
      byteArray.push(parseInt(textBitStr.slice(i, i + 8), 2));
    }

    // Return the byte array as a Float32Array.
    return new Float32Array(byteArray);
  }
}

/**
 * Returns the schema payload capacity based on the given version.
 *
 * @param schema_version - The version of the schema.
 * @returns - The payload capacity of the schema or 0 if the version is invalid.
 */
export function getSchemaCapacity(schema_version: number): number {
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
      throw new Error('Invalid schema version');
  }
}

/**
 * Returns the schema version based on the given binary array.
 *
 * @param binary_array - The input binary array.
 * @returns - The schema version.
 */
export function getSchemaVersion(binary_array: number[]): number {
  // Extract the last two bits from the binary array
  const last_two_bits = binary_array.slice(-2);

  // Calculate the version from the last two bits
  const version: number = last_two_bits[0] * 2 + last_two_bits[1];

  return version;
}
