//Stores the profile of the logged-in employer (Name, Phone, Email).
export const EMPLOYER_REGISTRATION_KEY = "daras_employer_registration";
//Stores the alerts and reports shown in the dashboard.
export const EMPLOYER_NOTIFICATIONS_KEY = "daras_employer_notifications";
//Stores the list of employees working for the employer.
export const EMPLOYEES_KEY = "daras_employer_employees";

export type EmployerRegistration =
  | {
      id: number;
      kind: "enterprise";
      companyName: string;
      country: string;
      companyEmail: string;
      phoneNumber: string;
    }
  | {
      id: number;
      kind: "individual";
      employerName: string;
      email?: string;
      phoneNumber: string;
    };

export type Employee = {
  id: string;
  email: string;
  nationalId: string;
  name: string;
  phoneNumber: string;
  licenseExpiration: string; // ISO date string or format 'YYYY-MM-DD'
  role: string;
  safetyScore: number; // 0-100, higher = safer
  trips: number;
  incidents: number;
  lastActive: string; // ISO date string
};

export type ReportNotification = {
  id: string;
  title: string;
  message: string;
  at: string;
  read: boolean;
};
