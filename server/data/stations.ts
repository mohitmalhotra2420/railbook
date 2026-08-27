import type { Station } from "../providers/types.js";

export const STATIONS: Station[] = [
  { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
  { code: "ASR", name: "Amritsar Junction", city: "Amritsar" },
  { code: "JUC", name: "Jalandhar City", city: "Jalandhar" },
  { code: "JRC", name: "Jalandhar Cantt", city: "Jalandhar" },
  { code: "JAT", name: "Jammu Tawi", city: "Jammu" },
  { code: "BEAS", name: "Beas", city: "Beas" },
  { code: "SVDK", name: "SMVD Katra", city: "Katra" },
  { code: "CDG", name: "Chandigarh", city: "Chandigarh" },
  { code: "UMB", name: "Ambala Cantt", city: "Ambala" },
  { code: "UBC", name: "Ambala City", city: "Ambala" },
  { code: "NDLS", name: "New Delhi", city: "Delhi" },
  { code: "DLI", name: "Delhi Junction", city: "Delhi" },
  { code: "NZM", name: "Hazrat Nizamuddin", city: "Delhi" },
  { code: "AGC", name: "Agra Cantt", city: "Agra" },
  { code: "AF", name: "Agra Fort", city: "Agra" },
  { code: "JP", name: "Jaipur Junction", city: "Jaipur" },
  { code: "LKO", name: "Lucknow NR", city: "Lucknow" },
  { code: "LJN", name: "Lucknow Junction NER", city: "Lucknow" },
  { code: "CNB", name: "Kanpur Central", city: "Kanpur" },
  { code: "CPA", name: "Kanpur Anwarganj", city: "Kanpur" },
  { code: "CNB2", name: "Kanpur Central", city: "Kanpur" },
  { code: "GKP", name: "Gorakhpur Junction", city: "Gorakhpur" },
  { code: "PNBE", name: "Patna Junction", city: "Patna" },
  { code: "DNR", name: "Danapur", city: "Patna" },
  { code: "HWH", name: "Howrah Junction", city: "Kolkata" },
  { code: "SDAH", name: "Sealdah", city: "Kolkata" },
  { code: "BBS", name: "Bhubaneswar", city: "Bhubaneswar" },
  { code: "BCT", name: "Mumbai Central", city: "Mumbai" },
  { code: "MMCT", name: "Mumbai Central", city: "Mumbai" },
  { code: "CSMT", name: "CSMT Mumbai", city: "Mumbai" },
  { code: "PUNE", name: "Pune Junction", city: "Pune" },
  { code: "ADI", name: "Ahmedabad Junction", city: "Ahmedabad" },
  { code: "BPL", name: "Bhopal Junction", city: "Bhopal" },
  { code: "RKMP", name: "Rani Kamalapati", city: "Bhopal" },
  { code: "NGP", name: "Nagpur Junction", city: "Nagpur" },
  { code: "HYB", name: "Hyderabad Deccan", city: "Hyderabad" },
  { code: "SC", name: "Secunderabad Junction", city: "Hyderabad" },
  { code: "MAS", name: "Chennai Central", city: "Chennai" },
  { code: "MS", name: "Chennai Egmore", city: "Chennai" },
  { code: "SBC", name: "KSR Bengaluru", city: "Bengaluru" },
  { code: "YPR", name: "Yesvantpur Junction", city: "Bengaluru" },
  { code: "TVC", name: "Thiruvananthapuram Central", city: "Thiruvananthapuram" },
  { code: "KCVL", name: "Kochuveli", city: "Thiruvananthapuram" },
  { code: "BZA", name: "Vijayawada Junction", city: "Vijayawada" },
  { code: "DDN", name: "Dehradun", city: "Dehradun" },
  { code: "HW", name: "Haridwar Junction", city: "Haridwar" },
  { code: "SRE", name: "Saharanpur Junction", city: "Saharanpur" },
  { code: "PTA", name: "Patiala", city: "Patiala" },
  { code: "RPJ", name: "Rajpura Junction", city: "Rajpura" },
  { code: "BTI", name: "Bathinda Junction", city: "Bathinda" },
  { code: "FZR", name: "Firozpur Cantt", city: "Firozpur" },
  { code: "FZP", name: "Firozpur City", city: "Firozpur" },
  { code: "PTK", name: "Pathankot Junction", city: "Pathankot" },
  { code: "PTKC", name: "Pathankot Cantt", city: "Pathankot" },
  { code: "ERS", name: "Ernakulam Junction", city: "Kochi" },
  { code: "ERN", name: "Ernakulam Town", city: "Kochi" },
];

const byCode = new Map(STATIONS.map((s) => [s.code, s]));

export function getStation(code: string): Station | undefined {
  return byCode.get(code.toUpperCase());
}

export function searchStations(q: string): Station[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return STATIONS;
  return STATIONS.filter(
    (s) =>
      s.code.toLowerCase().includes(needle) ||
      s.name.toLowerCase().includes(needle) ||
      s.city.toLowerCase().includes(needle),
  );
}
