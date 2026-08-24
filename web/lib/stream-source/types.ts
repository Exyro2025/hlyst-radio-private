// The ONE interface every stream source implements. The player component
// only ever talks to this shape — it never knows or cares whether the data
// came from Live365 or the HLYST controller.
//
// Place this file at: web/lib/stream-source/types.ts

export interface StreamSourceData {
  isLive: boolean;
  streamUrl: string;              // the actual audio URL for the <audio> tag
  currentDj: { name: string; avatar?: string | null } | null;
  currentShow: { name: string } | null;
  track: {
    title: string;
    artist: string | null;
    album?: string | null;
    artwork?: string | null;
  } | null;
  listeners?: number | null;
}

// Every source (Live365 today, the HLYST controller later, Talk Wave
// segments later still) implements this one method.
export interface StreamSource {
  getCurrentState(): Promise<StreamSourceData>;
}
