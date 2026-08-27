import type { Passenger } from "../types";

export const TRAVELLERS_KEY = "railbook.travellers.v1";

export function loadTravellers(): Passenger[] {
  try {
    return JSON.parse(localStorage.getItem(TRAVELLERS_KEY) ?? "[]") as Passenger[];
  } catch {
    return [];
  }
}

export function saveTravellers(list: Passenger[]): void {
  localStorage.setItem(TRAVELLERS_KEY, JSON.stringify(list));
}
