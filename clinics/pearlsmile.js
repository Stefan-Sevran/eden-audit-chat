const pearlsmileClinic = {
    clinicId: "pearlsmile",
    clinicCode: "PSD",

    countryCode: "PH",

    clinicName: "PearlSmile Dental",
    assistantName: "Maria",

    clinicType: "Dental clinic",
    city: "Cebu",
    country: "Philippines",
    timezone: "Asia/Manila",
    currency: "PHP",
    currencySymbol: "\u20B1",

    status: "demo",

    contact: {
      phone: "+63 917 555 0148",
      email: "hello@pearlsmile-demo.ph",
      address: "Cebu Business Park, Cebu City",
      mapUrl: "https://maps.google.com/?q=Cebu+Business+Park+Cebu+City"
    },

    languages: ["English", "Cebuano", "Tagalog"],

    openingHours: {
      monday: "9:00 AMÃ¢â‚¬â€œ6:00 PM",
      tuesday: "9:00 AMÃ¢â‚¬â€œ6:00 PM",
      wednesday: "9:00 AMÃ¢â‚¬â€œ6:00 PM",
      thursday: "9:00 AMÃ¢â‚¬â€œ6:00 PM",
      friday: "9:00 AMÃ¢â‚¬â€œ6:00 PM",
      saturday: "9:00 AMÃ¢â‚¬â€œ5:00 PM",
      sunday: "Closed"
    },

    bookingRules: {
      sameDayAllowed: true,
      confirmationRequired: true,
      depositRequired: false,
      cancellationNoticeHours: 24,
      lateArrivalMinutes: 15,
      emergencyInstruction:
        "For heavy bleeding, facial swelling with breathing difficulty, severe trauma, or a life-threatening emergency, call local emergency services or go to the nearest emergency department immediately."
    },

    paymentMethods: ["Cash", "GCash", "Maya", "Major cards"],

    insurancePolicy:
      "The clinic can provide receipts and treatment documents. Insurance coverage depends on the patient's individual plan and must be verified with the insurer before treatment.",

    availableSlots: ["10:00 AM", "2:00 PM", "4:00 PM"],

    services: [
      {
        id: "cleaning",
        name: "Teeth Cleaning",
        aliases: ["cleaning", "oral prophylaxis", "prophylaxis"],
        priceText: "Ã¢â€šÂ±1,500",
        estimatedVisitValue: 1500,
        durationMinutes: 45,
        consultationRequired: false,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "whitening",
        name: "Teeth Whitening",
        aliases: ["whitening", "teeth whitening", "bleaching"],
        priceText: "From Ã¢â€šÂ±7,500",
        estimatedVisitValue: 7500,
        durationMinutes: 90,
        consultationRequired: true,
        consultationPrice: 500,
        potentialServiceValueMin: 7500,
        potentialServiceValueMax: 12000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "braces_consultation",
        name: "Braces Consultation",
        aliases: ["braces", "orthodontics", "orthodontic consultation"],
        priceText: "Ã¢â€šÂ±500 consultation",
        estimatedVisitValue: 500,
        durationMinutes: 30,
        consultationRequired: true,
        consultationPrice: 500,
        potentialServiceName: "Braces treatment",
        potentialServiceValueMin: 45000,
        potentialServiceValueMax: 90000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "implant_consultation",
        name: "Dental Implant Consultation",
        aliases: ["implant", "dental implant", "missing tooth"],
        priceText: "Ã¢â€šÂ±500 consultation",
        estimatedVisitValue: 500,
        durationMinutes: 30,
        consultationRequired: true,
        consultationPrice: 500,
        potentialServiceName: "Dental implant",
        potentialServiceValueMin: 65000,
        potentialServiceValueMax: 95000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "veneers_consultation",
        name: "Veneers Consultation",
        aliases: ["veneers", "porcelain veneers"],
        priceText: "Ã¢â€šÂ±500 consultation",
        estimatedVisitValue: 500,
        durationMinutes: 30,
        consultationRequired: true,
        consultationPrice: 500,
        potentialServiceName: "Veneers",
        potentialServiceValueMin: 12000,
        potentialServiceValueMax: 25000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "emergency_dental",
        name: "Emergency Dental Assessment",
        aliases: ["tooth pain", "emergency", "swelling", "broken tooth", "toothache"],
        priceText: "Assessment from Ã¢â€šÂ±800; treatment depends on findings",
        estimatedVisitValue: 2000,
        durationMinutes: 30,
        consultationRequired: true,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true,
        urgent: true
      },
      {
        id: "kids_dentistry",
        name: "Kids Dentistry Visit",
        aliases: ["kids", "child", "children", "pediatric dentistry"],
        priceText: "From Ã¢â€šÂ±1,200",
        estimatedVisitValue: 1200,
        durationMinutes: 45,
        consultationRequired: false,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      }
    ],

    telegram: {
      bookingChatId: process.env.TELEGRAM_CHAT_ID_PEARLSMILE_BOOKINGS
    },

    googleSheets: {
      clinicLabel: "PearlSmile Dental",
      channelLabel: "Website AI booking chat"
    },

    commercialModel: {
      supportLevel: "AI_ONLY",
      edenRate: 0.10,
      defaultVisitValue: 2000
    },

    channels: {
      websiteChat: {
        enabled: true
      },

      missedCallResponder: {
        enabled: true,
        mode: "voice_plus_sms",
        stableForCommercialUse: true,
        sendsTelegramAlert: true,
        sendsBookingLinkSms: true,
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
  pearlsmileClinic
};
