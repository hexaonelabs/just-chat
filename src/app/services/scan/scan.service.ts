import { Injectable } from '@angular/core';
import { Html5Qrcode } from "html5-qrcode";

@Injectable({
  providedIn: 'root'
})
export class ScanService {

  private _scaner: Html5Qrcode | undefined;
  async _scanQrCode (
    html5QrcodeScanner: Html5Qrcode
  ): Promise<string | undefined> {
    try {
      const qrboxFunction = function (
        viewfinderWidth: number,
        viewfinderHeight: number
      ) {
        // Square QR Box, with size = 80% of the min edge width.
        const size = Math.min(viewfinderWidth, viewfinderHeight) * 0.8;
        return {
          width: size,
          height: size,
        };
      };
      console.log(">>", html5QrcodeScanner);
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        throw new Error("No camera found");
      }
  
      // get prefered back camera if available or load the first one
      const cameraId =
        cameras.find((c) => c.label.toLowerCase().includes("rear"))?.id ||
        cameras[0].id;
      console.log(">>", cameraId, cameras);
      // start scanner
      const config = {
        fps: 10,
        qrbox: qrboxFunction,
        // Important notice: this is experimental feature, use it at your
        // own risk. See documentation in
        // mebjas@/html5-qrcode/src/experimental-features.ts
        // experimentalFeatures: {
        //   useBarCodeDetectorIfSupported: true,
        // },
        // rememberLastUsedCamera: true,
        // showTorchButtonIfSupported: true,
      };
      if (!cameraId) {
        throw new Error("No camera found");
      }
      console.log("CameraId:", {cameraId, html5QrcodeScanner});
      // If you want to prefer front camera
      return new Promise((resolve, reject) => {
        html5QrcodeScanner.start(
          cameraId,
          config,
          (decodedText, decodedResult) => {
            console.log("decodedText", decodedText);
            // stop reader
            // resolve promise with the decoded text
            if (decodedText) {
              resolve(decodedText);
              html5QrcodeScanner.stop();
            }
          },
          (error) => { reject(error||'Error while scan'); }
        );
      });
    } catch (error: any) {
      throw new Error(error?.message || "BarcodeScanner not available");
    }
  };

  async scan(htmlElementId: string): Promise<string | undefined> {
    if (!this._scaner) {
      this._scaner = new Html5Qrcode(htmlElementId);
    }
    try {
      return await this._scanQrCode(this._scaner)
      .then((result) => {
        // if (this._scaner?.isScanning) {
        //   this._scaner.stop();
        // }
        return result;
      });
    } catch (error: any) {
      console.error(error);
      // if (this._scaner?.isScanning) {
      //   this._scaner.stop();
      // }
      return undefined;
    }
  }
}
