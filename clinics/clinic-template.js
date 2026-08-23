/*
  EDEN CLINIC TEMPLATE

  Copy this file when adding a new clinic.

  Then:
  1. Rename the file.
  2. Fill in clinic-specific values.
  3. Add the clinic to clinics/index.js.
  4. Run npm test.
*/

const clinicTemplate = {
  clinicId: "example-clinic",
  clinicCode: "EXM",

  countryCode: "XX",

  clinicName: "Example Clinic",
  assistantName: "Assistant Name",

  clinicType: "Clinic",
  city: "City",
  country: "Country",

  timezone: "Region/City",

  currency: "USD",
  currencySymbol: "$",

  status: "demo",

  contact: {
    phone: "",
    email: "",
    address: "",
    mapUrl: ""
  },

  languages: [
    "English"
  ],

  receptionistStyle:
    "Warm, calm, concise, professional and helpful.",

  openingHours: {
    monday: "",
    tuesday: "",
    wednesday: "",
    thursday: "",
    friday: "",
    saturday: "",
    sunday: ""
  },

  bookingRules: {
    sameDayAllowed: true,
    confirmationRequired: true,
    depositRequired: false,
    cancellationNoticeHours: 24,
    lateArrivalMinutes: 15,
    emergencyInstruction: ""
  },

  availableSlots: [],

  services: [
    /*
    {
      id: "service_id",
      name: "Service Name",
      aliases: [],
      priceText: "",
      estimatedVisitValue: 0,
      durationMinutes: 30,
      consultationRequired: true,
      aiCanRequestBooking: true,
      humanConfirmationRequired: true
    }
    */
  ],

  paymentMethods: [],

  insurancePolicy: "",

  telegram: {
    bookingChatId:
      process.env.TELEGRAM_CHAT_ID_EXAMPLE_CLINIC_BOOKINGS
  },

  googleSheets: {
    clinicLabel: "Example Clinic",
    channelLabel: "Website AI booking chat",
    intakeUrl: "",
    knowledgeUrl: ""
  },

  commercialModel: {
    supportLevel: "AI_ONLY",
    edenRate: 0.10,
    defaultVisitValue: 0
  },

  channels: {
    websiteChat: {
      enabled: true
    },

    missedCallResponder: {
      enabled: false,
      mode: "voice_plus_sms",
      stableForCommercialUse: false,
      sendsTelegramAlert: false,
      sendsBookingLinkSms: false,
      allowsHumanFollowUp: true
    },

    conversationalVoiceAI: {
      enabled: false,
      status: "development",
      stableForCommercialUse: false
    }
  }
};

module.exports = {
  clinicTemplate
};
