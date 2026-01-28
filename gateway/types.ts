// Gateway-specific message protocol types
// Re-exports common types from sdk/types for convenience

// Re-export all SDK types for backwards compatibility
export * from '../sdk/types';

// Import types needed for message definitions
import type { BotWorldState, BotAction, ActionResult } from '../sdk/types';

// ============ Gateway Message Types ============

// Messages from Bot Client → Gateway
export interface BotClientMessage {
    type: 'state' | 'actionResult' | 'setGoal' | 'connected' | 'screenshot_response';
    state?: BotWorldState;
    formattedState?: string;
    result?: ActionResult;
    actionId?: string;  // Echo back for correlation
    goal?: string;
    clientId?: string;
    username?: string;
    dataUrl?: string;       // For screenshot_response
    screenshotId?: string;  // For screenshot_response correlation
}

// Messages from Gateway → Bot Client
export interface SyncToBotMessage {
    type: 'action' | 'thinking' | 'error' | 'status' | 'screenshot_request';
    action?: BotAction;
    actionId?: string;  // For correlation
    thinking?: string;
    error?: string;
    status?: string;
    screenshotId?: string;  // For screenshot_request correlation
}

// Messages from SDK → Gateway
export interface SDKMessage {
    type: 'sdk_connect' | 'sdk_action' | 'sdk_screenshot_request';
    username: string;
    clientId?: string;
    actionId?: string;
    action?: BotAction;
    screenshotId?: string;  // For screenshot request correlation
}

// Messages from Gateway → SDK
export interface SyncToSDKMessage {
    type: 'sdk_connected' | 'sdk_state' | 'sdk_action_result' | 'sdk_error' | 'sdk_screenshot_response';
    success?: boolean;
    state?: BotWorldState;
    actionId?: string;
    result?: ActionResult;
    error?: string;
    screenshotId?: string;  // For screenshot response correlation
    dataUrl?: string;       // Screenshot data as data URL (image/png;base64,...)
}
