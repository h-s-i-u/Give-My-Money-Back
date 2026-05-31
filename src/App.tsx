import { useEffect, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { getRoom } from "./lib/roomApi";
import Home from "./components/Home";
import RoomDashboard from "./components/RoomDashboard";
import type { Room, RoomSession } from "./types";

const ROOM_ID_KEY = "current_room_id";
const MEMBER_ID_KEY = "current_member_id";

function App() {
  const { ready } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  // Restore the active room after a page refresh.
  useEffect(() => {
    const savedRoomId = localStorage.getItem(ROOM_ID_KEY);
    if (!savedRoomId) {
      setRestoring(false);
      return;
    }
    getRoom(savedRoomId)
      .then((restored) => {
        if (restored && restored.status === "active") {
          setRoom(restored);
          setMemberId(localStorage.getItem(MEMBER_ID_KEY));
        } else {
          localStorage.removeItem(ROOM_ID_KEY);
          localStorage.removeItem(MEMBER_ID_KEY);
        }
      })
      .catch((err) => console.error("Failed to restore room:", err))
      .finally(() => setRestoring(false));
  }, []);

  function enterRoom({ room, member }: RoomSession) {
    localStorage.setItem(ROOM_ID_KEY, room.id);
    localStorage.setItem(MEMBER_ID_KEY, member.id);
    setRoom(room);
    setMemberId(member.id);
  }

  function leaveRoom() {
    localStorage.removeItem(ROOM_ID_KEY);
    localStorage.removeItem(MEMBER_ID_KEY);
    setRoom(null);
    setMemberId(null);
  }

  if (!ready || restoring) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="animate-pulse text-lg font-bold text-cyan-300">Loading…</p>
      </main>
    );
  }

  return room ? (
    <RoomDashboard room={room} memberId={memberId} onLeave={leaveRoom} />
  ) : (
    <Home onEnter={enterRoom} />
  );
}

export default App;
