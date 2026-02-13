import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { environment } from '@env/environment';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private sockets: Map<string, WebSocket> = new Map();
  private messageSubjects: Map<string, Subject<any>> = new Map();

  constructor(private authService: AuthService) {}

  connect(channelId: string): Observable<any> {
    if (this.sockets.has(channelId)) {
      return this.messageSubjects.get(channelId)!.asObservable();
    }

    const subject = new Subject<any>();
    this.messageSubjects.set(channelId, subject);

    const token = this.authService.getToken();
    const ws = new WebSocket(`${environment.wsUrl}/${channelId}?token=${token}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      subject.next(data);
    };

    ws.onerror = () => {
      subject.next({ type: 'error', message: 'WebSocket error' });
    };

    ws.onclose = () => {
      this.sockets.delete(channelId);
      this.messageSubjects.delete(channelId);
      subject.complete();
    };

    this.sockets.set(channelId, ws);
    return subject.asObservable();
  }

  send(channelId: string, data: any): void {
    const ws = this.sockets.get(channelId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  disconnect(channelId: string): void {
    const ws = this.sockets.get(channelId);
    if (ws) {
      ws.close();
      this.sockets.delete(channelId);
      this.messageSubjects.delete(channelId);
    }
  }

  broadcastStatus(status: string): void {
    this.sockets.forEach((ws, channelId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'status_change', status }));
      }
    });
  }

  disconnectAll(): void {
    this.sockets.forEach((ws) => ws.close());
    this.sockets.clear();
    this.messageSubjects.clear();
  }
}
