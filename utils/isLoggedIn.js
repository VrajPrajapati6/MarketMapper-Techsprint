module.exports = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  if (req.method === "GET") {
    req.session.redirectUrl = req.originalUrl;
  }
  req.flash("error", "You must be signed in first!");
  res.redirect("/login");
};