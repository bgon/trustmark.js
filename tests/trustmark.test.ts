import { TrustMark } from '../dist/index.cjs';
import { assert } from 'chai';

let tm = new TrustMark();

let image_to_decode = 'tests/fixtures/Django_Reinhardt_(Gottlieb_07301)_watermarked.jpeg';
let image_to_encode = 'tests/fixtures/Quarry_Bay_apartments_(Unsplash).jpeg';
await tm.loadModels('Q');

describe('TrustMark Tests', () => {
  it('should return 28 whith encoding_type: TrustMark.Encoding.BCH_4', () => {
    const result = tm.ecc.bch_decoders['2'].ECCstate;
    assert.equal(result.ecc_bits, 28);
  });

  it('should return 56 whith encoding_type: TrustMark.Encoding.BCH_SUPER', () => {
    const result = tm.ecc.bch_decoders['0'].ECCstate;
    assert.equal(result.ecc_bits, 56);
  });

  it('should return InferenceSession for tm.decoderSession', async () => {
    assert.equal(tm.decoder_session.constructor.name, 'InferenceSession');
  });

  it('should return InferenceSession for tm.encoderSession', async () => {
    assert.equal(tm.encoder_session.constructor.name, 'InferenceSession');
  });

  it('should return watermark as valid', async () => {
    let result: any = await tm.decode(image_to_decode);
    assert.equal(result.valid, true);
  });

  it('should return the byte array length of pixel values of the image', async () => {
    let result: any = await tm.encode(image_to_encode, 'test');
    assert.equal(result.stego.length, 17479680);
  }).timeout(10000);

  for (let b = 1; b <= 5; b++) {
    it(`${b}/5 - should return the bytes length of of the image encoded as PNG`, async () => {
      let result: any = await tm.encode(image_to_encode, 'test', 0.4, false, 'png');
      assert.equal(result.stego.length, 8739352);
    });
  }
});
