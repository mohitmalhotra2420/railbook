/* 24 Sep 2026 (user: ConfirmTkt ka "Listening" screenshot — "hum bhi esa kuch bolne wala show karein?").
 * VoiceSheet = bolne wala screen: live transcript + quick chips + bada mic + ✍️ Type + ✕.
 * Ye test sirf UI lock karta hai (koi speech API nahi): chips/OK/✕ sab kaam karein,
 * aur "OK" sirf tab jab kuch bola gaya ho. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VoiceSheet, type VoiceSuggestion } from "../src/components/VoiceSheet";

const chips: VoiceSuggestion[] = [
  { id: "confirmed", label: "Get Confirmed Ticket", text: "sirf confirmed seat wali trains dikhao" },
  { id: "ac", label: "AC Trains", text: "AC trains dikhao" },
];

describe("VoiceSheet (bolne wala screen)", () => {
  it("band ho to kuch nahi dikhta", () => {
    const { container } = render(
      <VoiceSheet open={false} listening={false} interim="" level={0} status="" suggestions={chips} onOk={() => {}} onCancel={() => {}} onType={() => {}} onPick={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("khula ho to chips, transcript, mic aur Type/✕ dikhte hain", () => {
    render(
      <VoiceSheet open listening interim="" level={0.3} status="Main sun raha hoon…" suggestions={chips} onOk={() => {}} onCancel={() => {}} onType={() => {}} onPick={() => {}} />,
    );
    expect(screen.getByText("Get Confirmed Ticket")).toBeTruthy();
    expect(screen.getByText("AC Trains")).toBeTruthy();
    expect(screen.getByText(/bolo — jaise/)).toBeTruthy(); /* kuch bola nahi abhi */
    expect(screen.getByText("Listening…")).toBeTruthy();
    expect(screen.getByLabelText("Type karo")).toBeTruthy();
    /* kuch bole bina bhejna nahi */
    expect((screen.getByText("OK ✓ Bhejo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("bola hua live transcript me aata hai aur OK par bhejta hai (auto-send nahi)", () => {
    const onOk = vi.fn();
    render(
      <VoiceSheet open listening interim="Ludhiana se Delhi 2A me seat hai?" level={0.5} status="sun raha hoon" suggestions={chips} onOk={onOk} onCancel={() => {}} onType={() => {}} onPick={() => {}} />,
    );
    expect(screen.getByText("Ludhiana se Delhi 2A me seat hai?")).toBeTruthy();
    expect(onOk).not.toHaveBeenCalled(); /* khud se nahi bhejta */
    fireEvent.click(screen.getByText("OK ✓ Bhejo"));
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("chip tap = wahi sawaal seedha bhejta hai (boltne ki zaroorat nahi)", () => {
    const onPick = vi.fn();
    render(
      <VoiceSheet open listening={false} interim="" level={0} status="" suggestions={chips} onOk={() => {}} onCancel={() => {}} onType={() => {}} onPick={onPick} />,
    );
    fireEvent.click(screen.getByText("AC Trains"));
    expect(onPick).toHaveBeenCalledWith("AC trains dikhao");
  });

  it("✕ / scrim = band karo (cancel callback)", () => {
    const onCancel = vi.fn();
    render(
      <VoiceSheet open listening interim="kuch" level={0} status="" suggestions={chips} onOk={() => {}} onCancel={onCancel} onType={() => {}} onPick={() => {}} />,
    );
    fireEvent.click(screen.getAllByLabelText("Band karo")[0]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
