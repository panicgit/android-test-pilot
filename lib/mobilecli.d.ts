import { ChildProcess } from "node:child_process";
export interface MobilecliDevicesOptions {
    includeOffline?: boolean;
    platform?: "ios" | "android";
    type?: "real" | "emulator" | "simulator";
}
export interface MobilecliDevicesResponse {
    status: "ok";
    data: {
        devices: Array<{
            id: string;
            name: string;
            platform: "android" | "ios";
            type: "real" | "emulator" | "simulator";
            version: string;
        }>;
    };
}
export declare class Mobilecli {
    private path;
    constructor();
    private getPath;
    executeCommand(args: string[]): string;
    spawnCommand(args: string[]): ChildProcess;
    executeCommandBuffer(args: string[]): Buffer;
    private static getMobilecliPath;
    getVersion(): string;
    fleetListDevices(): string;
    fleetAllocate(platform: "ios" | "android"): string;
    fleetRelease(deviceId: string): string;
    getDevices(options?: MobilecliDevicesOptions): MobilecliDevicesResponse;
}
