import { Pipe, PipeTransform } from '@angular/core';
import { toDataURL } from 'qrcode';

@Pipe({
  name: 'toQrcode',
  standalone: true
})
export class ToQrcodePipe implements PipeTransform {

  async transform(value: string) {
    if (!value) {
      return undefined;
    }
    return await toDataURL(value, { errorCorrectionLevel: 'H', type: 'image/png' });
  }

}
