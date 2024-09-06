import { Component, inject } from '@angular/core';
import { ApiService } from './services/api/api.service';
import { AsyncPipe, JsonPipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToQrcodePipe } from './pipes/to-qrcode/to-qrcode.pipe';
import { ScanService } from './services/scan/scan.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NgIf, 
    NgFor, 
    AsyncPipe, 
    JsonPipe, 
    FormsModule,
    ToQrcodePipe,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  public title = 'just-chat';
  public peerId = '';
  public newRoom = '';
  public newMessage = '';
  public selectedRoom = '';
  public myAddress: string = '';

  public readonly api = inject(ApiService);
  public readonly scaner = inject(ScanService);

  showNodeAddress() {
    this.myAddress = this.api.getNodeAddress();
  }

  async scan() {
    // get dom element id for the scaner
    const htmlElementId = 'qr-code-reader';
    // scan the qr code
    const result = await this.scaner.scan(htmlElementId);
    if (result) {
      this.peerId = result;
    }
    console.log('result', result);
  }
}
