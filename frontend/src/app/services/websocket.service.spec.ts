import { TestBed } from '@angular/core/testing';
import { WebSocketService } from './websocket.service';
import { AuthService } from '@core/services/auth.service';

/* ---------- helpers ---------- */

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readyState: number = 0; // CONNECTING
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  // Constants matching the WebSocket spec
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  private openListeners: Array<() => void> = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, fn: () => void): void {
    if (event === 'open') this.openListeners.push(fn);
  }

  removeEventListener(event: string, fn: () => void): void {
    if (event === 'open') {
      this.openListeners = this.openListeners.filter((l) => l !== fn);
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }

  /* --- test-only helpers --- */
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
    this.openListeners.forEach((fn) => fn());
  }

  simulateMessage(data: any): void {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }

  simulateError(): void {
    if (this.onerror) this.onerror();
  }
}

describe('WebSocketService', () => {
  let service: WebSocketService;
  const authSpy = { getToken: jest.fn().mockReturnValue('test-token') };

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket as any;

    TestBed.configureTestingModule({
      providers: [
        WebSocketService,
        { provide: AuthService, useValue: authSpy },
      ],
    });
    service = TestBed.inject(WebSocketService);
  });

  afterEach(() => {
    service.disconnectAll();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /* --------- connect --------- */

  it('connect() should create a WebSocket and return an Observable', () => {
    const obs = service.connect('ch1');
    expect(obs).toBeTruthy();
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toContain('ch1');
    expect(MockWebSocket.instances[0].url).toContain('token=test-token');
  });

  it('connect() should reuse existing socket for same channel', () => {
    service.connect('ch1');
    service.connect('ch1');
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('connect() should create separate sockets for different channels', () => {
    service.connect('ch1');
    service.connect('ch2');
    expect(MockWebSocket.instances.length).toBe(2);
  });

  /* --------- messages --------- */

  it('should emit parsed messages through the observable', (done) => {
    const obs = service.connect('ch1');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    obs.subscribe((msg) => {
      expect(msg).toEqual({ type: 'new_message', text: 'hello' });
      done();
    });

    ws.simulateMessage({ type: 'new_message', text: 'hello' });
  });

  it('should emit error object on WebSocket error', (done) => {
    const obs = service.connect('ch1');
    const ws = MockWebSocket.instances[0];

    obs.subscribe((msg) => {
      expect(msg.type).toBe('error');
      done();
    });

    ws.simulateError();
  });

  it('should complete the observable on WebSocket close', (done) => {
    const obs = service.connect('ch1');
    const ws = MockWebSocket.instances[0];

    obs.subscribe({ complete: () => done() });

    ws.close();
  });

  /* --------- send --------- */

  it('send() should send JSON when socket is OPEN', () => {
    service.connect('ch1');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    service.send('ch1', { type: 'test' });
    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'test' });
  });

  it('send() should buffer message when socket is CONNECTING and flush on open', () => {
    service.connect('ch1');
    const ws = MockWebSocket.instances[0];
    expect(ws.readyState).toBe(0); // CONNECTING

    service.send('ch1', { type: 'buffered1' });
    service.send('ch1', { type: 'buffered2' });

    // Nothing sent yet
    expect(ws.sent.length).toBe(0);

    // Open the socket — buffered messages should flush
    ws.simulateOpen();

    expect(ws.sent.length).toBe(2);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'buffered1' });
    expect(JSON.parse(ws.sent[1])).toEqual({ type: 'buffered2' });
  });

  it('send() should do nothing when channelId has no socket', () => {
    expect(() => service.send('nonexistent', { type: 'x' })).not.toThrow();
  });

  /* --------- waitForOpen --------- */

  it('waitForOpen() should resolve immediately when socket is already OPEN', async () => {
    service.connect('ch1');
    MockWebSocket.instances[0].simulateOpen();

    await expect(service.waitForOpen('ch1')).resolves.toBeUndefined();
  });

  it('waitForOpen() should resolve when socket transitions to OPEN', async () => {
    service.connect('ch1');
    const ws = MockWebSocket.instances[0];

    const promise = service.waitForOpen('ch1');

    let resolved = false;
    promise.then(() => (resolved = true));

    await Promise.resolve();
    expect(resolved).toBe(false);

    ws.simulateOpen();
    await promise;
    expect(true).toBe(true); // reached here = resolved
  });

  it('waitForOpen() should resolve immediately for unknown channelId', async () => {
    await expect(service.waitForOpen('unknown')).resolves.toBeUndefined();
  });

  /* --------- disconnect --------- */

  it('disconnect() should close the socket and clean up', () => {
    service.connect('ch1');
    const ws = MockWebSocket.instances[0];

    service.disconnect('ch1');
    expect(ws.readyState).toBe(3); // CLOSED

    service.connect('ch1');
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it('disconnectAll() should close all sockets', () => {
    service.connect('ch1');
    service.connect('ch2');

    service.disconnectAll();

    expect(MockWebSocket.instances[0].readyState).toBe(3); // CLOSED
    expect(MockWebSocket.instances[1].readyState).toBe(3); // CLOSED
  });

  /* --------- broadcastStatus --------- */

  it('broadcastStatus() should send to all open sockets', () => {
    service.connect('ch1');
    service.connect('ch2');
    MockWebSocket.instances[0].simulateOpen();

    service.broadcastStatus('away');

    expect(MockWebSocket.instances[0].sent.length).toBe(1);
    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({
      type: 'status_change',
      status: 'away',
    });
    expect(MockWebSocket.instances[1].sent.length).toBe(0);
  });
});
