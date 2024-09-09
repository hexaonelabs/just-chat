import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  catchError,
  firstValueFrom,
  map,
  Observable,
  retry,
  throwError,
  timer,
} from 'rxjs';

import { Circuit } from '@multiformats/multiaddr-matcher';
import { createLibp2p, Libp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { PubSubBaseProtocol } from '@libp2p/pubsub';
import { identify } from '@libp2p/identify';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { webSockets } from '@libp2p/websockets';
import { multiaddr, protocols } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import { webTransport } from '@libp2p/webtransport';
import * as filters from '@libp2p/websockets/filters';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { yamux } from '@chainsafe/libp2p-yamux';
import { ElectronService } from 'ngx-electronyzer';

import { Message, Room } from '../../interfaces';

export const PUBSUB_PEER_DISCOVERY = 'browser-peer-discovery';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private libp2p!: Libp2p;
  private _bootstrapPeers: string[] = [];
  private readonly messagesSubject = new BehaviorSubject<{
    [roomId: string]: Message[];
  }>({});
  private readonly roomsSubject = new BehaviorSubject<Room[]>([]);
  private readonly _connected$ = new BehaviorSubject<boolean>(false);

  public readonly messages$ = this.messagesSubject.asObservable();
  public readonly messageFromRoom$ = (roomId: string) =>
    this.messages$.pipe(map((messages) => messages[roomId] || []));

  public readonly rooms$ = this.roomsSubject.asObservable();
  public readonly connected$ = this._connected$.asObservable();

  constructor(
    private readonly _electronService: ElectronService // private apiService: ApiService
  ) {

    this._init();
  }

  private async _init() {
    const isElectron = this._electronService.isElectronApp;
    if (isElectron) {
      console.log('[INFO] Running in Electron app');
      const bootstrapPeersRelayers = await this._electronService.ipcRenderer.invoke('get-relayer-addresses'); 
      console.log('[INFO] Bootstrap peers relayers:', bootstrapPeersRelayers);
      await this._initLibp2p({
        bootstrapPeers: bootstrapPeersRelayers,
      });
    } else {
      console.log('[INFO] Running in Browser');
      await this._initLibp2p({
        bootstrapPeers: [],
      });
    }
  }

  private async _initLibp2p({
    bootstrapPeers = [],
  }: { 
    bootstrapPeers?: string[];
  }) {
    this._bootstrapPeers = bootstrapPeers;
    this.libp2p = await createLibp2p({
      addresses: {
        listen: ['/webrtc'],
      },
      transports: [
        webSockets({
          // Allow all WebSocket connections inclusing without TLS
          filter: filters.all,
        }),
        webTransport(),
        webRTC(),
        circuitRelayTransport({
          discoverRelays: 5,
        }),
      ],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      connectionGater: {
        // Allow private addresses for local testing
        denyDialMultiaddr: async () => false,
      },
      peerDiscovery: [
        bootstrap({
          list: [
            ...this._bootstrapPeers,
          ],
        }),
        pubsubPeerDiscovery({
          interval: 10_000,
          topics: [PUBSUB_PEER_DISCOVERY],
        }),
      ],
      services: {
        pubsub: gossipsub(),
        identify: identify(),
      },
    });

    await this.libp2p.start();
    const multiaddrs = this.libp2p.getMultiaddrs().map((ma) => ma.toString());
    const peerId = this.libp2p.peerId.toString();
    console.log('My addresses:', {
      multiaddrs,
      peerId,
    });

    this.libp2p.addEventListener('peer:discovery', (evt) => {
      console.log('found peer: ', evt.detail);
    });

    await this._waitForPeers();
    this._listenNewRooms();
  }

  private async _waitForPeers(timeout = 60000 * 5): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkPeers = () => {
        const connectedPeers = this.libp2p.getPeers().length;
        if (connectedPeers > 0) {
          const details = this.getPeerDetails();
          this._connected$.next(true);
          console.log(`Connected to ${connectedPeers} peers:`, { details });
          resolve();
        } else {
          setTimeout(checkPeers, 1000);
        }
      };

      checkPeers();

      // Timeout 30 secondes by default
      setTimeout(() => reject(new Error('Timeout waiting for peers')), timeout);
    });
  }

  private async _publishWithRetry(
    topic: string,
    message: Message,
    maxRetries = 3
  ): Promise<void> {
    return firstValueFrom(
      new Observable<void>((observer) => {
        const pubsub = this.libp2p.services?.['pubsub'] as PubSubBaseProtocol;
        pubsub
          .publish(topic, new TextEncoder().encode(JSON.stringify(message)))
          .then(() => {
            observer.next();
            observer.complete();
          })
          .catch((err) => observer.error(err));
      }).pipe(
        retry({
          count: maxRetries,
          delay: (error, retryCount) => timer(1000 * retryCount),
        }),
        catchError((error) => {
          if (error.message.includes('NoPeersSubscribedToTopic')) {
            console.warn(
              `No peers subscribed to topic ${topic}. Message might not be delivered.`
            );
            return new Observable<void>((observer) => observer.complete());
          }
          return throwError(() => error);
        })
      )
    );
  }

  private _listenNewRooms() {
    const newRoomTopic = 'new-room';

    const pubsub = this.libp2p.services?.['pubsub'] as PubSubBaseProtocol;
    pubsub.subscribe(newRoomTopic);

    pubsub.addEventListener('message', (ev: any) => {
      if (ev.detail.topic === newRoomTopic) {
        const room = JSON.parse(
          new TextDecoder().decode(ev.detail.data)
        ) as Room;
        const currentRooms = this.roomsSubject.getValue();
        if (!currentRooms.some((r) => r.id === room.id)) {
          console.log('listen New room:', room);
          this.roomsSubject.next([...currentRooms, room]);
          this._listenMessages(room.id);
        }
      }
    });
  }

  private _listenMessages(roomId: string) {
    // return new Observable<Message>(observer => {

    const pubsub = this.libp2p.services?.['pubsub'] as PubSubBaseProtocol;
    const topics = pubsub.getTopics();
    // check if we are already subscribed to the topic
    if (topics.includes(roomId)) {
      console.log('Already subscribed to topic:', roomId);
      return;
    }
    pubsub.subscribe(roomId);
    console.log('Subscribed to topic:', roomId);

    const handler = (msg: any) => {
      const dataToParse = new TextDecoder().decode(msg);
      console.log('>>', { msg, dataToParse });
      const decodedMsg = JSON.parse(dataToParse) as Message;
      // observer.next(decodedMsg);

      // Update local messages
      const currentMessages = this.messagesSubject.getValue();
      const updatedMessages = {
        ...currentMessages,
        [roomId]: [...(currentMessages[roomId] || []), decodedMsg],
      };
      this.messagesSubject.next(updatedMessages);
    };

    pubsub.addEventListener('message', (evt: any) => {
      if (evt.detail.topic === roomId) {
        handler(evt.detail.data);
      }
    });

    // return () => {
    //   pubsub.unsubscribe(roomId);
    //   pubsub.removeEventListener('message', handler);
    // };
    // });
  }

  async createRoom(roomName: string) {
    const room: Room = {
      id: Date.now().toString(),
      name: roomName,
    };

    const pubsub = this.libp2p.services?.['pubsub'] as PubSubBaseProtocol;
    await pubsub.publish(
      'new-room',
      new TextEncoder().encode(JSON.stringify(room))
    );

    const currentRooms = this.roomsSubject.getValue();
    if (!currentRooms.some((r) => r.id === room.id)) {
      console.log('create room:', room);
      this.roomsSubject.next([...currentRooms, room]);
      this._listenMessages(room.id);
    }
  }

  async sendMessage(msg: string, roomId: string) {
    const message: Message = {
      id: Date.now().toString(),
      content: msg,
      sender: this.libp2p.peerId.toString(),
      timestamp: Date.now(),
    };
    try {
      await this._publishWithRetry(roomId, message);
      // Update local messages
      const currentMessages = this.messagesSubject.getValue();
      const updatedMessages = {
        ...currentMessages,
        [roomId]: [...(currentMessages[roomId] || []), message],
      };
      this.messagesSubject.next(updatedMessages);
    } catch (error: any) {
      console.error('Failed to send message after retries:', error);
      alert(
        'Failed to send message. ' + error.message || 'Please try again later.'
      );
    }
  }

  async connectToPeer(peerAddress: string) {
    let peerInfo;
    if (peerAddress.startsWith('/')) {
      peerInfo = multiaddr(peerAddress);
    } else {
      peerInfo = peerIdFromString(peerAddress);
    }

    try {
      const connection = await this.libp2p.dial(peerInfo);
      this._connected$.next(true);
      console.log('Connected to peer:', connection.remotePeer.toString());
    } catch (err) {
      this._connected$.next(false);
      console.error('Failed to connect to peer:', err);
    }
  }

  getNodeAddress(): string {
    const peerId = this.libp2p.peerId.toString();
    let addr = this.libp2p
      .getMultiaddrs()
      .find((ma) => ma.toString().includes('/ws/p2p/'))
      ?.toString();

    if (!addr) {
      addr = this.libp2p
        .getMultiaddrs()
        .find((ma) => ma.toString().includes('/webrtc/p2p/'))
        ?.toString();
    }

    if (!addr) {
      console.warn('No WebSocket or WebRTC address found, using PeerId only');
      addr = `/p2p/${peerId}`;
    }
    return addr;
  }

  getPeerDetails() {
    return this.libp2p.getPeers().map((peer) => {
      const peerConnections = this.libp2p.getConnections(peer);

      let nodeType = [];

      // detect if this is a bootstrap node
      if (this._bootstrapPeers.includes(peer.toString())) {
        nodeType.push('bootstrap');
      }

      const relayMultiaddrs = this.libp2p
        .getMultiaddrs()
        .filter((ma) => Circuit.exactMatch(ma));
      const relayPeers = relayMultiaddrs.map((ma) => {
        return ma
          .stringTuples()
          .filter(([name, _]) => name === protocols('p2p').code)
          .map(([_, value]) => value)[0];
      });

      // detect if this is a relay we have a reservation on
      if (relayPeers.includes(peer.toString())) {
        nodeType.push('relay');
      }
      return {
        peer: peer.toString(),
        nodeType,
        peerConnections: peerConnections.map((conn) =>
          conn.remoteAddr.toString()
        ),
      };
    });
  }
}
