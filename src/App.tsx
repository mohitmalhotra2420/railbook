import { useEffect, useState } from "react";
import { useBooking } from "./booking/context";
import { Bookings, Travellers, Wallet } from "./views/Account";
import { AdminModels } from "./views/AdminModels";
import { ClassSelect, SeatSelect } from "./views/ClassSeat";
import { Concierge } from "./views/Concierge";
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
  useEffect(() => {
    const onHash = () => setAdmin(isAdminHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (admin) return <AdminModels />;
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
    <div className="app">
      <Concierge />
      {overlay && <div className="overlay-screen">{overlay}</div>}
    </div>
  );
}
