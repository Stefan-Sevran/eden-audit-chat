const {
  pearlsmileClinic
} = require("./pearlsmile");

const {
  createPattayaSmileClinic
} = require("./pattaya-smile");

function createClinics() {
  const clinics = {
    pearlsmile: pearlsmileClinic
  };

  clinics["pattaya-smile"] =
    createPattayaSmileClinic(
      clinics.pearlsmile
    );

  return clinics;
}

module.exports = {
  createClinics
};
