const assert = require('node:assert/strict');
const {
  classifyDestination,
  buildDestinationControlIntelligence
} = require('./destination-control-v246');

{
  const c = classifyDestination('https://clinic.example/book', {
    auditedUrl: 'https://clinic.example/'
  });
  assert.equal(c.type, 'clinic-owned');
  assert.equal(c.controlLevel, 'high');
}

{
  const c = classifyDestination('https://cebudentalclinic.com/sample-clinic', {
    auditedUrl: 'https://clinic.example/'
  });
  assert.equal(c.type, 'aggregator-directory');
  assert.equal(c.controlLevel, 'low');
}

{
  const c = classifyDestination('https://www.facebook.com/sampleclinic', {
    auditedUrl: 'https://clinic.example/'
  });
  assert.equal(c.type, 'social-platform');
}

{
  const c = classifyDestination('https://calendly.com/sampleclinic', {
    auditedUrl: 'https://clinic.example/'
  });
  assert.equal(c.type, 'external-booking-provider');
}

{
  const result = buildDestinationControlIntelligence({
    reviewedUrl: 'https://clinic.example/',
    crossChannelContinuity: {
      channelMatrix: {
        website: { host: 'clinic.example', observed: true },
        google: {
          websiteDestination: 'https://cebudentalclinic.com/sample-clinic',
          bookingDestination: 'https://calendly.com/sampleclinic'
        },
        facebook: {
          websiteDestination: 'https://clinic.example/',
          bookingDestination: 'https://calendly.com/sampleclinic'
        },
        bookingJourney: {
          finalUrl: 'https://calendly.com/sampleclinic',
          confidence: 'verified'
        }
      }
    }
  });

  assert.equal(result.summary.aggregatorDirectoryCount, 1);
  assert.equal(result.summary.externalBookingProviderCount, 3);
  assert(
    result.contradictions.some(
      x => x.id === 'control-google-website-aggregator-primary'
    )
  );
  assert(
    result.claims.some(
      x => x.id === 'control-facebook-owned-entry' &&
           x.value === true
    )
  );
  assert(
    result.claims.some(
      x => x.id === 'control-external-booking-handoff'
    )
  );
}

{
  const result = buildDestinationControlIntelligence({
    reviewedUrl: 'https://clinic.example/',
    crossChannelContinuity: {
      channelMatrix: {
        bookingJourney: {
          finalUrl: 'https://cebudentalclinic.com/sample-clinic'
        }
      }
    }
  });

  assert(
    result.contradictions.some(
      x => x.id === 'control-booking-to-aggregator' &&
           x.blocksPublication === true
    )
  );
}

console.log(
  'PASS: V2.4.6 destination ownership, aggregator/social/external-booking classification, control scoring and booking-handoff gating.'
);
