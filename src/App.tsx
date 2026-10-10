import { useEffect, useState } from "react";
import { useBooking } from "./booking/context";
import { Bookings, Travellers, Wallet } from "./views/Account";
import { AdminModels } from "./views/AdminModels";
import { ClassSelect, SeatSelect } from "./views/ClassSeat";
import { Concierge } from "./views/Concierge";
import { Assistant } from "./views/Assistant";
import { isAssistantHash } from "./assistant/route";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Passengers } from "./views/Passengers";
import { FareReview, Status } from "./views/ReviewStatus";
import { RailTools } from "./views/RailTools";
import { TrainBoard } from "./views/TrainBoard";

function isAdminHash() {
  return /admin\/?models/i.test(window.location.hash);
}

export function App() {
  const { state } = useBooking();
  const [admin, setAdmin] = useState(isAdminHash);
  const [assistant, setAssistant] = useState(() => isAssistantHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setAdmin(isAdminHash());
      setAssistant(isAssistantHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (admin) return <AdminModels />;
  if (assistant) {
    return (
      <ErrorBoundary what="assistant">
        <Assistant />
      </ErrorBoundary>
    );
  }
  const overlay =
    state.screen === "bookings" ? (
      <Bookings />
    ) : state.screen === "wallet" ? (
      <Wallet />
    ) : state.screen === "travellers" ? (
      <Travellers />
    ) : state.screen === "tools" ? (
      <RailTools />
    ) : state.screen === "results" ? (
      <TrainBoard />
    ) : state.screen === "class" && state.selectedTrain ? (
      <ClassSelect />
    ) : state.screen === "seat" && state.selectedClass ? (
      <SeatSelect />
    ) : state.screen === "passengers" && state.selectedTrain ? (
      <Passengers />
    ) : state.screen === "review" && state.previewFare ? (
      <FareReview />
    ) : state.screen === "status" && state.booking ? (
      <Status />
    ) : null;

  return (
    /* Round-58: poora app boundary ke andar — koi bhi render error screen ko khaali nahi karega
     * (user screenshot: search ke baad blank page). */
    <div className="app">
      <ErrorBoundary what="chat">
        <Concierge />
      </ErrorBoundary>
      {overlay && (
        <div className="overlay-screen">
          <ErrorBoundary what="yeh screen" resetKey={state.screen}>
            {overlay}
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
