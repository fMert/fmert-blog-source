#!/usr/bin/env ruby
#
# Check for changed posts

Jekyll::Hooks.register :posts, :post_init do |post|

  next unless File.directory?('.git')
  source_path = File.join('_posts', File.basename(post.path))

  commit_num = `git rev-list --count HEAD -- "#{ source_path }"`

  if commit_num.to_i > 1
    lastmod_date = `git log -1 --pretty="%ad" --date=iso -- "#{ source_path }"`
    post.data['last_modified_at'] = lastmod_date
  end

end
