import { ToQrcodePipe } from './to-qrcode.pipe';

describe('ToQrcodePipe', () => {
  it('create an instance', () => {
    const pipe = new ToQrcodePipe();
    expect(pipe).toBeTruthy();
  });
});
