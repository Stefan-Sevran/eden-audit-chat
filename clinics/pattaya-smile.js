function createPattayaSmileClinic(baseClinic) {
  const pattayaSmileClinic = {
    ...baseClinic,
  
    clinicId: "pattaya-smile",
    clinicCode: "PST",
    countryCode: "TH",
    clinicName: "Pattaya Smile Dental",
    assistantName: "Nida",
    clinicType: "Premium digital dental clinic",
  
    city: "Pattaya",
    country: "Thailand",
    timezone: "Asia/Bangkok",
    currency: "THB",
    currencySymbol: "à¸¿",
    status: "demo",
  
    contact: {
      phone: "",
      email: "",
      address: "Pattaya, Thailand",
      mapUrl: ""
    },
  
    languages: ["English", "Thai"],
  
  receptionistStyle:
    "You are Nida: warm, elegant, calm and reassuring. Use natural English by default. Lightly mirror simple Thai only when the patient uses Thai. In the first reply, a gentle 'Sawadee ka' is welcome; do not repeat it in every message. Keep replies short, human and helpful. Never pressure the patient, invent facts, promise an appointment, or sound like a sales bot.",
    
    openingHours: {
      monday: "10:00 AM - 8:00 PM",
      tuesday: "10:00 AM - 8:00 PM",
      wednesday: "10:00 AM - 8:00 PM",
      thursday: "10:00 AM - 8:00 PM",
      friday: "10:00 AM - 8:00 PM",
      saturday: "10:00 AM - 8:00 PM",
      sunday: "10:00 AM - 8:00 PM"
    },
  
    bookingRules: {
      sameDayAllowed: true,
      confirmationRequired: true,
      depositRequired: false,
      cancellationNoticeHours: 24,
      lateArrivalMinutes: 15,
      emergencyInstruction:
        "For facial swelling with breathing difficulty, uncontrolled bleeding, severe trauma, or another serious emergency, seek urgent medical care immediately. For dental emergencies, Nida can request priority clinic follow-up."
    },
  
    availableSlots: [
      "10:00 AM",
      "12:00 PM",
      "2:00 PM",
      "4:00 PM",
      "6:00 PM"
    ],
  
    services: [
      {
        id: "smile_assessment",
        name: "Smile Assessment & Check-up",
        aliases: ["check-up", "checkup", "consultation", "smile assessment"],
        priceText: "Personalised quote after assessment",
        estimatedVisitValue: 1500,
        durationMinutes: 30,
        consultationRequired: true,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "scaling_polishing",
        name: "Scaling & Polishing",
        aliases: ["cleaning", "scaling", "polishing", "hygiene"],
        priceText: "Price confirmed by the clinic",
        estimatedVisitValue: 1500,
        durationMinutes: 45,
        consultationRequired: false,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "teeth_whitening",
        name: "Teeth Whitening",
        aliases: ["whitening", "bleaching"],
        priceText: "Personalised quote after assessment",
        estimatedVisitValue: 10000,
        durationMinutes: 90,
        consultationRequired: true,
        potentialServiceName: "Professional teeth whitening",
        potentialServiceValueMin: 8000,
        potentialServiceValueMax: 15000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "veneers_consultation",
        name: "Veneers & Smile Makeover Consultation",
        aliases: ["veneers", "smile makeover", "hollywood smile"],
        priceText: "Personalised quote after assessment",
        estimatedVisitValue: 1500,
        durationMinutes: 45,
        consultationRequired: true,
        potentialServiceName: "Veneers or smile makeover",
        potentialServiceValueMin: 25000,
        potentialServiceValueMax: 120000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "orthodontics_consultation",
        name: "Braces & Clear Aligner Consultation",
        aliases: ["braces", "invisalign", "clear aligners", "orthodontics"],
        priceText: "Personalised quote after assessment",
        estimatedVisitValue: 1500,
        durationMinutes: 30,
        consultationRequired: true,
        potentialServiceName: "Orthodontic treatment",
        potentialServiceValueMin: 35000,
        potentialServiceValueMax: 150000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "implant_consultation",
        name: "Dental Implant Consultation",
        aliases: ["implant", "dental implant", "missing tooth", "all-on-4", "all-on-6"],
        priceText: "Personalised quote after assessment",
        estimatedVisitValue: 1500,
        durationMinutes: 45,
        consultationRequired: true,
        potentialServiceName: "Dental implant treatment",
        potentialServiceValueMin: 45000,
        potentialServiceValueMax: 300000,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true
      },
      {
        id: "emergency_dental",
        name: "Urgent Dental Assessment",
        aliases: ["emergency", "tooth pain", "toothache", "swelling", "broken tooth"],
        priceText: "Clinic confirms urgency and cost",
        estimatedVisitValue: 2000,
        durationMinutes: 30,
        consultationRequired: true,
        aiCanRequestBooking: true,
        humanConfirmationRequired: true,
        urgent: true
      }
    ],
  
    paymentMethods: [
      "Cash",
      "Major cards",
      "Bank transfer",
      "Insurance claim documents"
    ],
  
    insurancePolicy:
      "Insurance details must be confirmed by the clinic team.",
  
    telegram: {
      bookingChatId:
        process.env.TELEGRAM_CHAT_ID_PATTAYA_SMILE_BOOKINGS
    },
  
    googleSheets: {
      clinicLabel: "Pattaya Smile Dental",
      channelLabel: "Website AI booking chat",
    intakeUrl:
      "https://script.google.com/macros/s/AKfycby_9UvHenDdcahFUwfiMfFiOIjyxl9LWSYquhof3XdALHFd1hpbkD4eGhty8RsJ_aKH/exec",
  
    knowledgeUrl:
      "https://script.google.com/macros/s/AKfycbwLIihsBb6PYlAVksrHtysGWKr0lFPNg76vzGuDd2isizD_8RuCd4pwWoJ8xP--CNzWWw/exec"
  
    }
  };

  return pattayaSmileClinic;
}

module.exports = {
  createPattayaSmileClinic
};
