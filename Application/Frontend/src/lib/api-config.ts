export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://daras-backend.vercel.app/api/v1";

export const API_ENDPOINTS = {
  LOGIN: `${API_BASE_URL}/api/v1/employer/login`,
  EMPLOYERS: `${API_BASE_URL}/api/v1/employer/register`,
  ADD_EMPLOYEE: `${API_BASE_URL}/api/v1/employment/employer/request`,
  REPORTS: `${API_BASE_URL}/api/v1/dashboard/employer/fleet-analysis`,
  EMPLOYER_SEVER_DRIVER: (driverId: string) => `${API_BASE_URL}/api/v1/employment/employer/sever/${driverId}`,
  RANKINGS: `${API_BASE_URL}/api/v1/dashboard/employer/drivers`,
  DRIVERS: `${API_BASE_URL}/api/v1/drivers`,
  DEVICES: `${API_BASE_URL}/api/v1/dashboard/employer/devices`,
  REGISTER_DEVICE: `${API_BASE_URL}/api/v1/devices`,
  VERIFY: `${API_BASE_URL}/api/v1/verify`,
  DRIVER_LOGIN: `${API_BASE_URL}/api/v1/driver/login`,
  DRIVER_REGISTER: `${API_BASE_URL}/api/v1/driver/register`,
  DRIVER_DETAILS: (driverId: string) => `${API_BASE_URL}/api/v1/dashboard/employer/drivers/${driverId}/details`,
  DRIVER_DASHBOARD_DETAILS: `${API_BASE_URL}/api/v1/dashboard/driver/details`,
  DRIVER_RESPOND_REQUEST: (reqId: string) => `${API_BASE_URL}/api/v1/employment/driver/requests/${reqId}/respond`,
  DRIVER_START_TRIP: `${API_BASE_URL}/api/v1/dashboard/driver/start-trip`,
  DRIVER_END_TRIP: `${API_BASE_URL}/api/v1/dashboard/driver/end-trip`,
  CALIB_SNAPSHOT_REQUEST: `${API_BASE_URL}/api/v1/dashboard/driver/calibration/request-snapshot`,
  CALIB_SNAPSHOT_POLL: (serial: string) => `${API_BASE_URL}/api/v1/dashboard/driver/calibration/snapshot/${serial}`,
  CALIB_SUBMIT: `${API_BASE_URL}/api/v1/dashboard/driver/calibration/save`,
};

export const COMMON_HEADERS = {
  "Accept": "application/json",
};

export function getEmployerAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("daras_employer_token");
}

export function getDriverAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("daras_driver_token");
}

export function getEmployerId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem("daras_employer_registration") || localStorage.getItem("daras_employer_registration");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.id?.toString() || localStorage.getItem("current_employer_id") || null;
    } catch {
      return localStorage.getItem("current_employer_id") || null;
    }
  }
  return localStorage.getItem("current_employer_id") || null;
}
