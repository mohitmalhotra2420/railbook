/* Round-18m-24 (user LDH→CNB screenshot): 22432 / 18310 board mein "2S — Refresh" column, jabki in
 * trains mein 2S coach hai hi nahi. erail search list "2S" ko unreserved ke liye bhi likhta hai —
 * usi row ka rake composition sach batata hai. Sirf jhoothi class hataate hain, kabhi add nahi. */
import { describe, expect, it } from "vitest";
import { parseErailTrainList } from "../server/railway/webscrape.js";

const ROW_22432 = "22432~SFG MCTM SF EXP~Mtyr C Tushar M~MCTM~Subedarganj~SFG~Ludhiana Jn~LDH~Kanpur Central~CNB~21.25~09.55~12.30~0010001~~~~~~~~111001011000000~10~5~1~5~16.05~12.55~16~0010001~21.15~10.00~SUPERFAST~8073~2~0~DATASOURCE_IR~2026-06-17~2050-01-02~754~60~SUPERFAST:754:2725,1405:1645,805~0~0~~60~1~~~~Super Fast~~1~NR~~BG~~~100000000100~,,En:SLRD,SLRD,SLRD:GN,GN,GN:M,M1,3E:B,B1,3A:H,H1,1A:A,A1,2A:S,S1,SL:GN,GN,GN:LPR,LPR,LPR:~1~1~1A:4::::::::::|2A:2:32::8:::::::|2S:::::::::::|3A:47:182::28:::::::2|3E:16::::::::::|SL:35:144::28::6:::::4|~~~~~~~3~5~X~~~~~1~";
const ROW_12057 = "12057~JANSHATABDI EXP~New Delhi~NDLS~Una Himachal~UHL~New Delhi~NDLS~Chandigarh~CDG~07.40~10.55~3.15~1111111~~~~~~~~111~10~5~1~5~07.40~10.55~16~1111111~07.40~10.55~SUPERFAST~1~2~0~DATASOURCE_IR~2026-01-01~2050-01-02~245~60~SUPERFAST:245:~0~0~~60~1~~~~Super Fast~~1~NR~~BG~~~1~,,En:SLRD,SLRD,SLRD:D,D1,2S:D,D2,2S:C,C1,CC:LPR,LPR,LPR:~1~1~2S:::::::::::|CC:::::::::::|~~~~~~~3~5~X~~~~~1~";
const ROW_NO_RAKE = "14670~JAMMU TAWI EXP~Amritsar~ASR~Jaynagar~JYG~Ludhiana Jn~LDH~Kanpur Central~CNB~11.05~04.15~17.10~0100100~~~~~~~~111~10~5~1~5~11.05~04.15~16~0100100~11.05~04.15~MAIL_EXPRESS~1~2~0~DATASOURCE_IR~2026-01-01~2050-01-02~700~60~MAIL_EXPRESS:700:~0~0~~60~1~~~~Mail~~1~NR~~BG~~~1~~1~1~2A:::::::::::|3A:::::::::::|SL:::::::::::|~~~~~~~3~5~X~~~~~1~";

describe("Round-18m-24: erail search list — drop classes that are not in the train's rake", () => {
  it("22432: 2S removed (no D/2S coach), 1A/2A/3A/3E/SL kept", () => {
    const r = parseErailTrainList(ROW_22432)[0];
    expect(r.number).toBe("22432");
    expect(r.classes).toEqual(["1A", "2A", "3A", "3E", "SL"]);
  });
  it("12057 Janshatabdi: 2S kept because rake really has 2S coaches", () => {
    const r = parseErailTrainList(ROW_12057)[0];
    expect(r.classes).toEqual(["2S", "CC"]);
  });
  it("no rake data → class list untouched (never invent, never over-prune)", () => {
    const r = parseErailTrainList(ROW_NO_RAKE)[0];
    expect(r.classes).toEqual(["2A", "3A", "SL"]);
  });
});
