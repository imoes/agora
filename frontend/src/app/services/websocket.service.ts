import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { environment } from '@env/environment';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private sockets: Map<string, WebSocket> = new Map();
  private messageSubjects: Map<string, Subject<any>> = new Map();
  private sendBuffers: Map<string, string[]> = new Map();
  private openPromises: Map<string, Promise<void>> = new Map();

  /** Emits messages from ALL channels – useful for global notifications like incoming calls. */
  private globalMessageSubject = new Subject<any>();
  globalMessages$ = this.globalMessageSubject.asObservable();

  constructor(private authService: AuthService) {}

  connect(channelId: string): Observable<any> {
    if (this.sockets.has(channelId)) {
      return this.messageSubjects.get(channelId)!.asObservable();
    }

    const subject = new Subject<any>();
    this.messageSubjects.set(channelId, subject);
    this.sendBuffers.set(channelId, []);

    const token = this.authService.getToken();
    const ws = new WebSocket(`${environment.wsUrl}/${channelId}?token=${token}`);

    // Track when the WebSocket is actually open
    const openPromise = new Promise<void>((resolve) => {
      ws.onopen = () => {
        // Flush any buffered messages
        const buffer = this.sendBuffers.get(channelId) || [];
        buffer.forEach((msg) => ws.send(msg));
        this.sendBuffers.set(channelId, []);
        resolve();
      };
    });
    this.openPromises.set(channelId, openPromise);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      subject.next(data);
      this.globalMessageSubject.next(data);
    };

    ws.onerror = () => {
      subject.next({ type: 'error', message: 'WebSocket error' });
    };

    ws.onclose = () => {
      this.sockets.delete(channelId);
      this.messageSubjects.delete(channelId);
      this.sendBuffers.delete(channelId);
      this.openPromises.delete(channelId);
      subject.complete();
    };

    this.sockets.set(channelId, ws);
    return subject.asObservable();
  }

  /** Returns a promise that resolves when the WebSocket for channelId is open. */
  waitForOpen(channelId: string): Promise<void> {
    const ws = this.sockets.get(channelId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return this.openPromises.get(channelId) || Promise.resolve();
  }

  send(channelId: string, data: any): void {
    const ws = this.sockets.get(channelId);
    if (!ws) return;

    const msg = JSON.stringify(data);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      // Buffer the message – it will be flushed when the socket opens
      const buffer = this.sendBuffers.get(channelId);
      if (buffer) {
        buffer.push(msg);
      }
    }
  }

  disconnect(channelId: string): void {
    const ws = this.sockets.get(channelId);
    if (ws) {
      ws.close();
      this.sockets.delete(channelId);
      this.messageSubjects.delete(channelId);
      this.sendBuffers.delete(channelId);
      this.openPromises.delete(channelId);
    }
  }

  broadcastStatus(status: string): void {
    this.sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'status_change', status }));
      }
    });
  }

  disconnectAll(): void {
    this.sockets.forEach((ws) => ws.close());
    this.sockets.clear();
    this.messageSubjects.clear();
    this.sendBuffers.clear();
    this.openPromises.clear();
  }
}
