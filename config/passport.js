const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User.js");

passport.use(
  new LocalStrategy({ usernameField: "email" }, User.authenticate())
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.CLIENT_URL}/auth/google/callback`,
    },
    async function (accessToken, refreshToken, profile, done) {
      try {
        let user = await User.findOne({ googleId: profile.id });

        const profileImage =
          profile.photos && profile.photos.length > 0
            ? profile.photos[0].value.replace("http://", "https://")
            : "https://upload.wikimedia.org/wikipedia/commons/2/2c/Default_pfp.svg";

        if (user) {
          user.image = profileImage;
          await user.save();
          return done(null, user);
        }

        user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          user.googleId = profile.id;
          user.image = profileImage;
          await user.save();
          return done(null, user);
        }

        user = await User.create({
          username: profile.displayName,
          email: profile.emails[0].value,
          googleId: profile.id,
          image: profileImage,
        });

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
