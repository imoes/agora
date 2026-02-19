// Mock quill before importing the component (Quill uses ESM which Jest cannot handle)
jest.mock('quill', () => {
  return { default: class MockQuill {} };
});

import { ChatRoomComponent } from './chat-room.component';

/* ------------------------------------------------------------------ */
/*  Minimal construction – only the fields used by computeFirstUnread  */
/* ------------------------------------------------------------------ */

function createComponent(): ChatRoomComponent {
  const comp = Object.create(ChatRoomComponent.prototype) as ChatRoomComponent;
  comp.messages = [];
  comp.lastReadMessageId = null;
  comp.firstUnreadMessageId = null;
  comp.currentUser = { id: 'user-1' } as any;
  return comp;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('ChatRoomComponent – computeFirstUnread', () => {
  let component: ChatRoomComponent;

  beforeEach(() => {
    component = createComponent();
  });

  function callComputeFirstUnread() {
    // computeFirstUnread is private – call via bracket notation
    (component as any).computeFirstUnread();
  }

  it('should return null when there are no messages', () => {
    component.lastReadMessageId = 'msg-1';
    component.messages = [];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBeNull();
  });

  it('should return null when lastReadMessageId is null', () => {
    component.lastReadMessageId = null;
    component.messages = [
      { id: 'msg-1', sender_id: 'other-user' },
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBeNull();
  });

  it('should return the first unread message from another user', () => {
    component.lastReadMessageId = 'msg-2';
    component.messages = [
      { id: 'msg-1', sender_id: 'other-user' },
      { id: 'msg-2', sender_id: 'other-user' },
      { id: 'msg-3', sender_id: 'other-user' },
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBe('msg-3');
  });

  it('should skip own messages and find the first message from another user', () => {
    component.lastReadMessageId = 'msg-1';
    component.messages = [
      { id: 'msg-1', sender_id: 'other-user' },
      { id: 'msg-2', sender_id: 'user-1' },  // own message – should be skipped
      { id: 'msg-3', sender_id: 'user-1' },  // own message – should be skipped
      { id: 'msg-4', sender_id: 'other-user' },  // first unread from others
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBe('msg-4');
  });

  it('should return null when all unread messages are from the current user', () => {
    component.lastReadMessageId = 'msg-1';
    component.messages = [
      { id: 'msg-1', sender_id: 'other-user' },
      { id: 'msg-2', sender_id: 'user-1' },  // own
      { id: 'msg-3', sender_id: 'user-1' },  // own
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBeNull();
  });

  it('should return null when last read is the last message (no unreads)', () => {
    component.lastReadMessageId = 'msg-3';
    component.messages = [
      { id: 'msg-1', sender_id: 'other-user' },
      { id: 'msg-2', sender_id: 'user-1' },
      { id: 'msg-3', sender_id: 'other-user' },
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBeNull();
  });

  it('should handle last read message not in batch (all messages are new)', () => {
    component.lastReadMessageId = 'msg-old';  // not in the array
    component.messages = [
      { id: 'msg-5', sender_id: 'user-1' },  // own – skip
      { id: 'msg-6', sender_id: 'other-user' },  // first unread from others
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBe('msg-6');
  });

  it('should return null when last read not in batch and all messages are own', () => {
    component.lastReadMessageId = 'msg-old';
    component.messages = [
      { id: 'msg-5', sender_id: 'user-1' },
      { id: 'msg-6', sender_id: 'user-1' },
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBeNull();
  });

  it('should handle mixed own and other messages correctly', () => {
    component.lastReadMessageId = 'msg-2';
    component.messages = [
      { id: 'msg-1', sender_id: 'other-user' },
      { id: 'msg-2', sender_id: 'user-1' },
      { id: 'msg-3', sender_id: 'user-1' },   // own – skip
      { id: 'msg-4', sender_id: 'user-1' },   // own – skip
      { id: 'msg-5', sender_id: 'other-user-2' },  // first from others
      { id: 'msg-6', sender_id: 'other-user' },
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBe('msg-5');
  });

  it('should place divider at first other-user message even if own message is first unread', () => {
    // This is the key scenario: user sent messages after reading, then
    // someone else replied. The divider should be at the reply, NOT at
    // the user's own message.
    component.lastReadMessageId = 'msg-10';
    component.messages = [
      { id: 'msg-10', sender_id: 'other-user' },
      { id: 'msg-11', sender_id: 'user-1' },    // own – no divider here
      { id: 'msg-12', sender_id: 'other-user' }, // divider should be here
      { id: 'msg-13', sender_id: 'other-user' },
    ];
    callComputeFirstUnread();
    expect(component.firstUnreadMessageId).toBe('msg-12');
  });
});
